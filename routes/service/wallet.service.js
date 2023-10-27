const db = require('../../db'),
    moment = require('moment'),
    express = require('express'),
    router = express.Router(),
    enums = require('../../enums'),
    helperFunctions = require('../../helper-functions');

router.get('/create/:id', helperFunctions.verifyJWT, async (req, res) => {
    const user = await helperFunctions.getUser(req.params.id);
    if (user.verification === enums.USER.VERIFICATION.PENDING) 
        return res.send({
            "status": 500,
            "error": 'Your account is pending verification!',
            "response": null
        });

    let wallets = await helperFunctions.getUserWallets(user.id);
    if (wallets.length) 
        return res.send({
            "status": 200,
            "error": null,
            "response": wallets,
            "message": 'User wallet account already exists!'
        });

    let payload = {
        firstname: user.firstname,
        lastname: user.lastname,
        email: user.email,
        phonenumber: user.phone,
        is_permanent: true,
        bvn: user.bvn,
        narration: `${user.firstname} ${user.lastname}`
    }
    const ngn = await helperFunctions.createVirtualAccount(payload);
    if (ngn.status === "success") {
        wallets.push({
            currency: enums.WALLET_TRANSACTION.CURRENCY.NGN,
            bank: ngn.data?.bank_name,
            account: ngn.data?.account_number
        });
    } else {
        return res.send({
            "status": 500,
            "error": ngn.message,
            "response": null
        });
    }
    
    delete payload.bvn;
    payload.currency = enums.WALLET_TRANSACTION.CURRENCY.USD;
    const usd = await helperFunctions.createVirtualAccount(payload);
    if (usd.status === "success") {
        wallets.push({
            currency: payload.currency,
            bank: usd.data?.bank_name,
            account: usd.data?.account_number
        });
    } else if (
        usd.message === "Merchant is not approved to generate Virtual USD accounts, please contact support."
    ) {
        wallets.push({
            currency: payload.currency,
            bank: process.env.TENANT,
            account: helperFunctions.padWithZeroes(user.id, 10)
        });
    } else {
        return res.send({
            "status": 500,
            "error": usd.message,
            "response": null
        });
    }

    const date = moment().utcOffset('+0100').format('YYYY-MM-DD H:mm:ss a');
    await Promise.all(wallets.map(wallet => {
        wallet.user_id = user.id;
        wallet.date_created = date;
        return new Promise(resolve => {
            db.query('INSERT INTO wallets SET ?', wallet, error => {
                if (error) console.log(error)
                resolve();
            });
        });
    }))

    wallets = await helperFunctions.getUserWallets(user.id);
    return res.send({
        "status": 200,
        "error": null,
        "response": wallets
    });
});

router.get('/get/:id', helperFunctions.verifyJWT, async (req, res) => {
    let wallets = await helperFunctions.getUserWallets(req.params.id);
    wallets = await Promise.all(wallets.map(async wallet => {
        wallet.balance = await helperFunctions.getWalletBalance(wallet.id);
        return wallet;
    }));
    return res.send({
        "status": 200,
        "error": null,
        "response": wallets
    });
});

router.post('/webhook', async (req, res) => {
    const { body } = req;
    console.log('[WALLET WEBHOOK]:', body, new Date().toISOString());
    delete body["event.type"];

    if (!body || !body.data)
        return res.status(500).send({
            responseCode: 500,
            status: "failure"
        });

    if (body.event === "charge.completed") {
        const { payment_type, amount, customer, flw_ref, status, currency } = body.data;
        if (!amount || !payment_type || !flw_ref) {
            console.log("[SETTLEMENT ERROR]:", "Required parameters not sent!");
            return res.status(400).send({
                responseCode: 400,
                status: "failure"
            });
        }

        const verify_transaction = await helperFunctions.verifyTransaction(flw_ref);
        if (!verify_transaction || verify_transaction.status !== "success") {
            console.log('[SETTLEMENT ERROR]:', `Reference ${flw_ref} is not valid!`);
            return res.status(400).send({
                responseCode: 400,
                status: "failure"
            });
        }

        let query = `SELECT id FROM settlements WHERE flw_ref = "${flw_ref}"`;
        db.query(query, (error, duplicate_settlement) => {
            if (error) {
                console.log('[SETTLEMENT ERROR]:', error);
                return res.status(400).send({
                    responseCode: 400,
                    status: "failure"
                });
            }

            if (duplicate_settlement.length) {
                console.log('[SETTLEMENT ERROR]:', `Reference ${flw_ref} already exists!`);
                return res.send({
                    responseCode: 400,
                    status: "failure"
                });
            }

            query = 'INSERT INTO settlements SET ?';
            db.query(query, body.data, error => {
                if (error) {
                    console.log('[SETTLEMENT ERROR]:', error);
                    return res.send({
                        responseCode: 400,
                        status: "failure"
                    });
                }
        
                query = `SELECT w.* FROM wallets w, users u WHERE w.user_id = u.id AND w.currency = "${currency}" AND u.email = "${customer.email}"`;
                db.query(query, async (error, wallet) => {
                    if (error) {
                        console.log('[SETTLEMENT ERROR]:', error);
                        return res.send({
                            responseCode: 400,
                            status: "failure"
                        });
                    }
            
                    if (wallet[0])
                        await helperFunctions.createWalletTransaction({
                            amount,
                            currency,
                            reference: flw_ref,
                            wallet_id: wallet[0]['id'],
                            user_id: wallet[0]['user_id'],
                            description: `Topup | ${description}`,
                            type: enums.WALLET_TRANSACTION.TYPE.CREDIT,
                            date_created: moment().utcOffset('+0100').format('YYYY-MM-DD h:mm:ss a'),
                            category: payment_type === "bank_transfer" ? 
                                enums.WALLET_TRANSACTION.CATEGORY.BANK_CREDIT : enums.WALLET_TRANSACTION.CATEGORY.CARD_CREDIT
                        });
            
                    res.send({
                        responseCode: 200,
                        status: "success"
                    });
                });
            });
        });
    } else {
        return res.status(200).send({
            responseCode: 200,
            status: "success"
        });
    }
});

router.post(
    '/withdraw/:id/:wallet_id/:pin/:amount',
    helperFunctions.verifyJWT, 
    helperFunctions.checkDuplicate,
async (req, res) => {
    const {id, pin, amount, wallet_id} = req.params;
    const {bank, account, account_name, description: description_, meta} = req.body;
    if (!bank || !account || !account_name)
        return res.send({
            "status": 500,
            "error": "Required parameter(s) not sent!",
            "response": null
        });

    if (!helperFunctions.isValidAmount(amount) || Number(amount) <= 0)
        return res.send({
            "status": 500,
            "error": `Invalid transaction amount! ${amount}`,
            "response": null
        });
    
    const pin_verified = await helperFunctions.verifyPin(id, pin);
    if (!pin_verified)
        return res.send({
            "status": 500,
            "error": "Incorrect pin!",
            "response": null
        });

    const description = helperFunctions.sanitizeString(description_);
    const wallet_balance = await helperFunctions.getWalletBalance(wallet_id);
    if (Number(amount) > Number(wallet_balance))
        return res.send({
            "status": 500,
            "error": "Insufficient funds in wallet!",
            "response": null
        });

    const wallet = await helperFunctions.getWallet(wallet_id);
    if (!wallet)
        return res.send({
            "status": 500,
            "error": "Wallet not found!",
            "response": null
        });

    const banks = await helperFunctions.getBanks(wallet.currency);
    const bank_ = banks.find(e => e.code === bank);
    if (!bank_)
        return res.send({
            "status": 500,
            "error": "Invalid bank!",
            "response": null
        });

    const _isWalletAccount = await helperFunctions._isWalletAccount(account);
    if (_isWalletAccount)
        return res.send({
            "status": 500,
            "error": "Transfer to virtual account is not allowed!",
            "response": null
        });

    const reference = `${wallet.account}-${Date.now()}`;
    const transaction = {
        amount,
        wallet_id,
        reference,
        user_id: id,
        currency: wallet.currency
    }
    await helperFunctions.createWalletTransaction({
        ...transaction,
        type: enums.WALLET_TRANSACTION.TYPE.DEBIT,
        description: `${description || 'Withdrawal'} | TO ${bank_.name} ${account_name}`,
        date_created: moment().utcOffset('+0100').format('YYYY-MM-DD h:mm:ss a'),
        category: enums.WALLET_TRANSACTION.CATEGORY.BANK_DEBIT
    });

    let payload = {
        meta,
        amount,
        reference,
        account_bank: bank,
        account_number: account,
        currency: wallet.currency,
        debit_currency: wallet.currency,
        narration: description || 'Wallet Withdrawal',
        beneficiary_name: `${req.user.firstname} ${req.user.lastname}`
    }
    let response = await helperFunctions.initiateTransfer(payload)
    if (!response || !response.data)
        return res.send({
            "status": 500,
            "error": 'An error occurred!',
            "response": null
        });
    
    response = await helperFunctions.getTransaction(response.data.id)
    if (response && response.status === "success") {
        res.send({
            "status": 200,
            "error": null,
            "response": `Withdrawal of NGN${amount} paid successfully!`
        });
    } else {
        await helperFunctions.createWalletTransaction({
            ...transaction,
            type: enums.WALLET_TRANSACTION.TYPE.CREDIT,
            description: `Reversal | FROM ${process.env.TENANT}`,
            date_created: moment().utcOffset('+0100').format('YYYY-MM-DD h:mm:ss a'),
            category: enums.WALLET_TRANSACTION.CATEGORY.REVERSAL
        });

        res.send({
            "status": 500,
            "error": response.complete_message,
            "response": null
        });
    }
});

router.post(
    '/transfer/:id/:wallet_id/:pin/:amount',
    helperFunctions.verifyJWT,
    helperFunctions.checkDuplicate,
async (req, res) => {
    const {id, pin, amount, wallet_id} = req.params;
    const {wallet, description: description_} = req.body;
    if (!wallet)
        return res.send({
            "status": 500,
            "error": "Required parameter(s) not sent!",
            "response": null
        });

    if (!helperFunctions.isValidAmount(amount) || Number(amount) <= 0)
        return res.send({
            "status": 500,
            "error": `Invalid transaction amount! ${amount}`,
            "response": null
        });
    
    const pin_verified = await helperFunctions.verifyPin(id, pin);
    if (!pin_verified)
        return res.send({
            "status": 500,
            "error": "Incorrect pin!",
            "response": null
        });

    const description = helperFunctions.sanitizeString(description_);
    const wallet_balance = await helperFunctions.getWalletBalance(wallet_id);
    if (Number(amount) > Number(wallet_balance))
        return res.send({
            "status": 500,
            "error": "Insufficient funds in wallet!",
            "response": null
        });

    const sender_ = await helperFunctions.getWallet(wallet_id);
    if (!sender_)
        return res.send({
            "status": 500,
            "error": "Sender wallet not found!",
            "response": null
        });

    const beneficiary_ = await helperFunctions.getWallet(wallet);
    if (!beneficiary_)
        return res.send({
            "status": 500,
            "error": "Beneficiary wallet not found!",
            "response": null
        });

    const sender = {
        ...sender_,
        ...await helperFunctions.getUser(sender_.user_id)
    };
    const beneficiary = {
        ...beneficiary_,
        ...await helperFunctions.getUser(beneficiary_.user_id)
    };
    const reference = `${sender.account}-${Date.now()}`;
    await helperFunctions.createWalletTransaction({
        amount,
        reference,
        user_id: id,
        wallet_id: sender.id,
        currency: sender.currency,
        type: enums.WALLET_TRANSACTION.TYPE.DEBIT,
        description: `${description || 'Withdrawal'} | TO ${beneficiary.firstname} ${beneficiary.lastname} ${beneficiary.account}`,
        date_created: moment().utcOffset('+0100').format('YYYY-MM-DD h:mm:ss a'),
        category: enums.WALLET_TRANSACTION.CATEGORY.TRANSFER_DEBIT
    });
    await helperFunctions.createWalletTransaction({
        amount,
        reference,
        user_id: beneficiary.user_id,
        wallet_id: beneficiary.id,
        currency: beneficiary.currency,
        type: enums.WALLET_TRANSACTION.TYPE.CREDIT,
        description: `${description || 'Topup'} | FROM ${sender.firstname} ${sender.lastname} ${sender.account}`,
        date_created: moment().utcOffset('+0100').format('YYYY-MM-DD h:mm:ss a'),
        category: enums.WALLET_TRANSACTION.CATEGORY.TRANSFER_CREDIT
    });

    return res.send({
        "status": 200,
        "error": null,
        "response": `Transfer of NGN${amount} paid successfully!`
    });
});

router.get(
    '/card/topup/:id/:wallet_id/:card_id/:amount',
    helperFunctions.verifyJWT, 
    helperFunctions.checkDuplicate,
async (req, res) => {
    const {id, wallet_id, card_id, amount} = req.params;
    if (!wallet_id || !card_id || !amount)
        return res.send({
            "status": 500,
            "error": "Required parameter(s) not sent!",
            "response": null
        });

    if (!helperFunctions.isValidAmount(amount) || Number(amount) <= 0)
        return res.send({
            "status": 500,
            "error": `Invalid transaction amount! ${amount}`,
            "response": null
        });

    const wallet = await helperFunctions.getWallet(wallet_id);
    if (!wallet)
        return res.send({
            "status": 500,
            "error": "Wallet not found!",
            "response": null
        });
    
    const card = await helperFunctions.getCard(card_id);
    const reference = `${wallet.account}-${Date.now()}`;
    const response = await helperFunctions.chargeCard({
        amount,
        token: card.token,
        email: req.user.email,
        currency: card.currency,
        tx_ref: reference
    });
    if (response.status !== "success")
        return res.send({
            "status": 500,
            "error": null,
            "response": response.message
        });

    await helperFunctions.createWalletTransaction({
        amount,
        wallet_id,
        reference,
        user_id: id,
        currency: wallet.currency,
        type: enums.WALLET_TRANSACTION.TYPE.CREDIT,
        description: `Topup | FROM ${response.data.customer ? 
            response.data.customer.name : ""} ${response.data.tx_ref}`,
        date_created: moment().utcOffset('+0100').format('YYYY-MM-DD h:mm:ss a'),
        category: enums.WALLET_TRANSACTION.CATEGORY.CARD_CREDIT
    });

    return res.send({
        "status": 200,
        "error": null,
        "response": `Wallet topup of NGN${amount} paid successfully!`
    });
});

router.get('/transactions/get/:id', helperFunctions.verifyJWT, (req, res) => {
    const query = `SELECT * FROM transactions WHERE user_id = ${req.params.id} AND status = 1 ORDER BY id desc`;
    db.query(query, (error, response) => {
        if (error) 
            return res.send({
                "status": 500,
                "error": error,
                "response": null
            });
        
        return res.send({
            "status": 200,
            "error": null,
            "response": response
        });
    });
});

router.get('/transaction/get/:id/:transaction_id', helperFunctions.verifyJWT, (req, res) => {
    const {transaction_id} = req.params;
    let query = `SELECT * FROM transactions WHERE id = ${transaction_id} AND status = 1`;
    db.query(query, async (error, transaction) => {
        if (error) 
            return res.send({
                "status": 500,
                "error": error,
                "response": null
            });
        if (!transaction || !transaction[0]) 
            return res.send({
                "status": 500,
                "error": "Transaction not found!",
                "response": null
            });
        transaction = transaction[0];
        delete transaction.status;
        transaction.meta = {};

        const wallet = await helperFunctions.getWallet(transaction.wallet_id);
        if (!wallet || !transaction.reference)
            return res.send({
                "status": 200,
                "error": null,
                "response": transaction
            });

        transaction.wallet = wallet;
        switch(transaction.category) {
            case enums.WALLET_TRANSACTION.CATEGORY.BANK_DEBIT:
            case enums.WALLET_TRANSACTION.CATEGORY.BANK_CREDIT:
            case enums.WALLET_TRANSACTION.CATEGORY.CARD_CREDIT: {
                const response = await helperFunctions.verifyTransaction(transaction.reference);
                if (response && response.status === "success") 
                    return res.send({
                        "status": 200,
                        "error": null,
                        "response": {
                            ...transaction,
                            meta: response
                        }
                    });

                return res.send({
                    "status": 500,
                    "error": response.message,
                    "response": null
                });
            }
            default: {
                return res.send({
                    "status": 200,
                    "error": null,
                    "response": transaction
                });
            }
        }
    });
});

module.exports = router;