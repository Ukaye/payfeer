let functions = {};

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

module.exports = functions;