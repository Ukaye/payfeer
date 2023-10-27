const moment = require('moment'),
    db = require('../../db'),
    express = require('express'),
    enums = require('../../enums'),
    router = express.Router(),
    helperFunctions = require('../../helper-functions');

router.get('/initiate/:id/:currency', helperFunctions.verifyJWT, async (req, res) => {
    const {id, currency} = req.params;
    if (!enums.WALLET_TRANSACTION.CURRENCY[currency])
        return res.send({
            "status": 500,
            "error": "Unsupported currency.",
            "response": null
        });

    const user = await helperFunctions.getUser(id);
    const response = helperFunctions.initiateCard({
        tx_ref: user.id,
        amount: 50,
        payment_options: "card",
        customer: {
            name: `${user.firstname} ${user.lastname}`,
            email: user.email
        },
        redirect_url: "https://checkout-testing.herokuapp.com",
        currency
    })
    if (response.status === "success")
        return res.send({
            "status": 200,
            "error": null,
            "response": {
                link: body.data.link,
                reference: user.id
            }
        });
        
    res.send({
        "status": 500,
        "error": null,
        "response": body.message
    });
});

router.post('/create/:id', helperFunctions.verifyJWT, async (req, res) => {
    const {id} = req.params;
    const {reference} = req.body;
    const response = await helperFunctions.verifyTransaction(reference);
    if (response.status !== "success")
        return res.send({
            "status": 500,
            "error": null,
            "response": response.message
        });

    let data = response.data ? response.data.card : {};
    data.user_id = id;
    data.reference = body.data.tx_ref;
    data.currency = body.data.currency;
    data.status = enums.CARD.STATUS.ACTIVE;
    data.date_created = moment().utcOffset('+0100').format('YYYY-MM-DD h:mm:ss a');

    db.query(`SELECT * FROM cards WHERE last_4digits = '${data.last_4digits}' AND expiry = '${data.expiry}' 
        AND currency = '${data.currency}' AND type = '${data.type}' AND issuer = '${data.issuer}' 
        AND country = '${data.country}' AND user_id = '${id}' AND status = 1`,
    (error, card) => {
        if (error)
            return res.send({
                "status": 500,
                "error": error,
                "response": null
            });

        if (card[0])
            return res.send({
                "status": 500,
                "error": null,
                "response": 'Card already exists!'
            });

        db.query('INSERT INTO cards SET ?', data, error => {
            if (error) {
                res.send({
                    "status": 500,
                    "error": error,
                    "response": null
                });
            } else {
                return res.send({
                    "status": 200,
                    "error": null,
                    "response": data,
                    "message": "Card added successfully!"
                });
            }
        });
    });
});

router.get('/get/:id', helperFunctions.verifyJWT, (req, res) => {
    db.query(`SELECT * FROM cards WHERE user_id = ${req.params.id} AND status = 1`,
        (error, cards) => {
            if (error) return res.send({
                "status": 500,
                "error": error,
                "response": null
            });
            return res.send({
                "status": 200,
                "error": null,
                "response": cards
            });
        });
});

router.delete('/delete/:id/:card_id', helperFunctions.verifyJWT, (req, res) => {
    const {id, card_id} = req.params;
    const update = {
        status: enums.CARD.STATUS.INACTIVE,
        date_modified: moment().utcOffset('+0100').format('YYYY-MM-DD h:mm:ss a')
    }
    const query = `UPDATE cards SET ? WHERE id = ${card_id} AND user_id = ${id}`;
    db.query(query, update, error => {
            if (error)
                return res.send({
                    "status": 500,
                    "error": error,
                    "response": null
                });

            res.send({
                "status": 200,
                "error": null,
                "response": "Card deleted successfully!"
            });
        });
});

module.exports = router;