const express = require('express'),
    router = express.Router(),
    enums = require('../../enums'),
    helperFunctions = require('../../helper-functions');

router.get('/', (req, res) => res.send('You have reached the Payfeer service!'));

router.get('/enums', (req, res) => res.send({
    status: 200,
    error: null,
    response: enums
}));

router.get('/banks/:currency', async (req, res) => {
    const {currency} = req.params;
    if (!currency)
        return res.send({
            "status": 500,
            "error": "Required parameter(s) not sent!",
            "response": null
        });

    const banks = await helperFunctions.getBanks(currency);
    res.send({
        "status": 200,
        "error": null,
        "response": banks
    });
});

router.get('/account/resolve/:account/:bank', async (req, res) => {
    const {account, bank} = req.params;
    if (!account || !bank)
        return res.send({
            "status": 500,
            "error": "Required parameter(s) not sent!",
            "response": null
        });

    const response = await helperFunctions.resolveAccount({
        account_number: account,
        account_bank: bank
    });
    if (response && response.status === "success")
        return res.send({
            "status": 200,
            "error": null,
            "response": response.data
        });

    res.send({
        "status": 500,
        "error": response.message || 'An error occurred!',
        "response": null
    });
});

router.get('/transfer-rates/get/:amount/:source_currency/:destination_currency', async (req, res) => {
    const {amount, source_currency, destination_currency} = req.params;
    if (!amount || !source_currency || !destination_currency)
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

    if (!enums.WALLET_TRANSACTION.CURRENCY[source_currency])
        return res.send({
            "status": 500,
            "error": "Unsupported source currency.",
            "response": null
        });

    if (!enums.WALLET_TRANSACTION.CURRENCY[destination_currency])
        return res.send({
            "status": 500,
            "error": "Unsupported destination currency.",
            "response": null
        });

    const response = await helperFunctions.getTransferRates(amount, source_currency, destination_currency);
    if (response && response.status === "success")
        return res.send({
            "status": 200,
            "error": null,
            "response": response.data
        });

    res.send({
        "status": 500,
        "error": response.message || 'An error occurred!',
        "response": null
    });
});

module.exports = router;