const express = require('express'),
    router = express.Router(),
    enums = require('../../enums');

router.get('/enums', (req, res) => res.send({
    status: 200,
    error: null,
    response: enums
}));

module.exports = router;