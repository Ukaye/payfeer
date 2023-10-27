const 
    enums = require('./enums'),
    request = require('request'),
    bcrypt = require('bcryptjs'),
    jwt = require('jsonwebtoken'),
    emailService = require('./routes/service/email.service');

let functions = {};

functions.generateOTP = () => Math.floor(100000 + Math.random() * 900000);

functions.formatOTP = otp => otp.toString().match(/\d{1,3}/g).join(' ');

functions.formatToNigerianPhone = phone => {
    return phone ? `234${phone.toString().trim().toLowerCase().substr(-10)}` : '';
};

functions.sanitizeString = str => (str || '').replace(/[^\w\s]/gi, '').substring(0, 100)

functions.isValidAmount = amount => !isNaN(amount) && !isNaN(parseFloat(amount))

functions.verifyJWT = (req, res, next) => {
    let token = req.headers['x-access-token'] || (req.headers.authorization || '').split(" ")[1];;
    if (!token) return res.send({
        "status": 500,
        "error": null,
        "response": "No token provided!"
    });

    jwt.verify(token, process.env.SECRET_KEY, function (err, decoded) {
        if (err) return res.send({
            "status": 500,
            "error": err,
            "response": "Failed to authenticate token!"
        });

        if (decoded.type !== enums.USER.TYPE.ADMIN && req.params.user_id && parseInt(req.params.user_id) !== decoded.id)
            return res.send({
                "status": 500,
                "error": err,
                "response": "Unauthorized operation!"
            });

        req.user = decoded;
        next();
    });
};

functions.getUser = user => {
    return new Promise(resolve => {
        const query = `SELECT id, username, firstname, lastname, email, phone, status FROM users 
            WHERE id = "${user}" OR username = "${user}" OR email = "${user}" OR phone = "${user}"`;
        db.query(query, (error, user) => resolve(user ? user[0] : {}));
    });
};

functions.createVirtualAccount = payload => {
    return new Promise(async resolve => {
        console.log('[CREATE VIRTUAL ACCOUNT PAYLOAD]:', payload)
        request.post(
            {
                url: `${process.env.FLUTTERWAVE_BASE_URL}/virtual-account-numbers`,
                headers: {
                    Authorization: `Bearer ${process.env.FLUTTERWAVE_SECRET_KEY}`
                },
                body: payload,
                json: true
            },
            (error, res, body) => {
                if (error) {
                    console.log('[CREATE VIRTUAL ACCOUNT ERROR]:', error)
                    return resolve(error)
                }
                console.log('[CREATE VIRTUAL ACCOUNT RESPONSE]:', body)
                return resolve(body);
            }
        );
    });
}

functions.getTransaction = id => {
    return new Promise(async resolve => {
        request.get(
            {
                url: `${process.env.FLUTTERWAVE_BASE_URL}/transfers/${id}`,
                headers: {
                    Authorization: `Bearer ${process.env.FLUTTERWAVE_SECRET_KEY}`
                },
                json: true
            },
            (error, res, body) => {
                if (error) {
                    console.log('[GET TRANSACTION ERROR]:', reference, error)
                    return resolve(error)
                }
                return resolve(body);
            }
        );
    });
}

functions.getUserWallets = user_id => {
    return new Promise(resolve => {
        const query = `SELECT id, bank, account, currency FROM wallets WHERE user_id = ${user_id} AND status = 1`;
        db.query(query, (error, response) => resolve(response));
    });
};

functions.getWallet = wallet_id => {
    return new Promise(resolve => {
        const query = `SELECT bank, account, currency FROM wallets WHERE id = ${wallet_id} AND status = 1`;
        db.query(query, (error, response) => resolve(response));
    });
};

functions.createWalletTransaction = (transaction) => {
    return new Promise(async resolve => {
        const query = 'INSERT INTO transactions SET ?';
        if (transaction.type === 'debit') 
            transaction.amount *= -1;
        db.query(query, transaction, error => {
            if (error) console.log(error);
            
            const mailOptions = {
                to: transaction.userID,
                subject: 'Transaction Notification',
                template: 'default',
                context: {
                    name: 'Customer',
                    message: `NGN ${functions.numberToCurrencyFormatter(Math.abs(transaction.amount))} ${
                        transaction.type} for ${transaction.description} on ${transaction.date_created}`
                }
            }
            emailService.send(mailOptions);

            return resolve(true);
        });
    });
};

functions.getWalletBalance = wallet_id => {
    return new Promise(resolve => {
        let query = `SELECT ROUND(COALESCE(SUM(amount), 0), 2) amount FROM transactions WHERE wallet_id = ${wallet_id} AND status = 1`;
        db.query(query, (error, wallet_balance) => {
            if (wallet_balance && wallet_balance[0])
                return resolve(wallet_balance[0]['amount']);
            resolve(0);
        });
    });
};

functions._isWalletAccount = account => {
    return new Promise(resolve => {
        const query = `SELECT id FROM wallets WHERE account = "${account}"`;
        db.query(query, (error, accounts) => resolve(accounts.length > 0));
    });
};

functions.createTransferRecipient = (user_id, bank_account) => {
    return new Promise(resolve => {
        request.post(
            {
                url: `${process.env.PAYSTACK_BASE_URL}/transferrecipient`,
                headers: {
                    Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
                },
                body: {
                    type: "nuban",
                    name: bank_account.account_name,
                    description: functions.padWithZeroes(user_id, 6),
                    account_number: bank_account.account,
                    bank_code: bank_account.bank,
                    currency: "NGN"
                },
                json: true
            },
            (error, res, body) => {
                if (body && body.status && body.data) resolve(body.data);
                resolve(false);
            }
        );
    });
}

functions.verifyPin = (user_id, pin) => {
    return new Promise(resolve => {
        const query = `SELECT pin FROM users WHERE id = ${user_id}`;
        db.query(query, (error, user) => {
            user = user[0];
            if (!user.pin) return resolve(false);
            const status = bcrypt.compareSync(pin.toString(), user.pin);
            resolve(status);
        });
    });
};

functions._isntUser = user_id => {
    return new Promise(resolve => {
        let query = `SELECT status FROM users WHERE id = ${user_id}`;
        db.query(query, (error, user) => {
            if (error)
                return resolve({
                    "status": 500,
                    "error": "Connection Error!",
                    "response": null
                });

            if (!user || !user[0])
                return resolve({
                    "status": 500,
                    "error": "Sorry, we can't find this information in our record, please check again or create an account if you are a new user.",
                    "response": null
                });

            user = user[0];
            if (user.status === enums.USER.STATUS.INACTIVE)
                return resolve({
                    "status": 500,
                    "error": "Your account has been disabled, please contact support.",
                    "response": null
                });
            
            resolve(false);
        });
    });
};

let wallet_logs = [];
functions.checkDuplicate = async (req, res, next)  => {        
    // confirm user
    const error = await functions._isntUser(req.user.id);
    if (error) {
        console.log(`[INVALID CLIENT]: ${req.user.username}, ${error}`);
        return res.send(error);
    }

    // duplicate request check
    const reference = `${req.user.id}-${Date.now().toString().slice(0, 8)}`;
    if (wallet_logs.indexOf(reference) > -1) {
        console.log(`[DUPLICATE TRANSACTION]: ${reference}, ${wallet_logs}`);
        return res.send({
            "status": 500,
            "error": "Duplicate transaction!",
            "response": wallet_logs
        });
    }
    
    wallet_logs.push(reference);
    next();
}

functions.resolveAccount = body => {
    return new Promise(resolve => {
        request.post(
            {
                url: `${process.env.FLUTTERWAVE_BASE_URL}/accounts/resolve`,
                headers: {
                    'Authorization': `Bearer ${process.env.FLUTTERWAVE_SECRET_KEY}`
                },
                body,
                json: true
            },
            (error, res, body) => {
                if (error) {
                    console.log('[RESOLVE ACCOUNT ERROR]:', error)
                    return resolve(error)
                }
                return resolve(body);
            });
    })
};

functions.initiateTransfer = body => {
    return new Promise(resolve => {
        request.post(
            {
                url: `${process.env.FLUTTERWAVE_BASE_URL}/transfers`,
                headers: {
                    'Authorization': `Bearer ${process.env.FLUTTERWAVE_SECRET_KEY}`
                },
                body,
                json: true
            },
            (error, res, body) => {
                if (error) {
                    console.log('[INITIATE TRANSFER ERROR]:', error)
                    return resolve(error)
                }
                return resolve(body);
            });
    })
};

functions.getBanks = currency => {
    let country = "";
    switch (currency) {
        case enums.WALLET_TRANSACTION.CURRENCY.NGN : {
            country = "NG";
            break;
        }
        case enums.WALLET_TRANSACTION.CURRENCY.USD : {
            country = "US";
            break;
        }
    }
    return new Promise(resolve => {
        request.get(
            {
                url: `${process.env.FLUTTERWAVE_BASE_URL}/banks/${country}`,
                headers: {
                    'Authorization': `Bearer ${process.env.FLUTTERWAVE_SECRET_KEY}`
                },
                json: true
            },
            (error, res, body) => {
                if (error) {
                    console.log('[GET BANKS ERROR]:', currency, error)
                    return resolve(error)
                }
                return resolve(body ? body.data : []);
            });
    })
};

functions.getTransferRates = (amount, source_currency, destination_currency) => {
    return new Promise(resolve => {
        request.get(
            {
                url: `${process.env.FLUTTERWAVE_BASE_URL}/transfers/rates?amount=${amount
                    }&source_currency=${source_currency}&destination_currency=${destination_currency}`,
                headers: {
                    'Authorization': `Bearer ${process.env.FLUTTERWAVE_SECRET_KEY}`
                },
                json: true
            },
            (error, res, body) => {
                if (error) {
                    console.log('[GET TRANSFER RATES ERROR]:', error)
                    return resolve(error)
                }
                return resolve(body ? body.data : {});
            });
    })
};

functions.initiateCard = body => {
    return new Promise(resolve => {
        request.post(
            {
                url: `${process.env.FLUTTERWAVE_BASE_URL}/payments`,
                headers: {
                    'Authorization': `Bearer ${process.env.FLUTTERWAVE_SECRET_KEY}`
                },
                body,
                json: true
            },
            (error, res, body) => {
                if (error) {
                    console.log('[INITIATE CARD ERROR]:', error)
                    return resolve(error)
                }
                return resolve(body);
            });
    })
};

functions.verifyTransaction = reference => {
    return new Promise(async resolve => {
        request.get(
            {
                url: `${process.env.FLUTTERWAVE_BASE_URL}/transactions/verify_by_reference?tx_ref=${reference}`,
                headers: {
                    Authorization: `Bearer ${process.env.FLUTTERWAVE_SECRET_KEY}`
                },
                json: true
            },
            (error, res, body) => {
                if (error) {
                    console.log('[VERIFY TRANSACTION ERROR]:', reference, error)
                    return resolve(error)
                }
                return resolve(body);
            }
        );
    });
}

functions.chargeCard = body => {
    return new Promise(async resolve => {
        request.post(
            {
                url: `${process.env.FLUTTERWAVE_BASE_URL}/tokenized-charges`,
                headers: {
                    Authorization: `Bearer ${process.env.FLUTTERWAVE_SECRET_KEY}`
                },
                body,
                json: true
            },
            (error, res, body) => {
                if (error) {
                    console.log('[CHARGE CARD ERROR]:', error)
                    return resolve(error)
                }
                return resolve(body);
            }
        );
    });
}

functions.getCard = card_id => {
    return new Promise(resolve => {
        const query = `SELECT * FROM cards WHERE id = ${card_id}`;
        db.query(query, (error, card) => resolve(card ? card[0] : {}));
    });
};

module.exports = functions;