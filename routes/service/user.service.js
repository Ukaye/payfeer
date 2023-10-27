const db = require('../../db'),
    moment = require('moment'),
    bcrypt = require('bcryptjs'),
    express = require('express'),
    router = express.Router(),
    jwt = require('jsonwebtoken'),
    enums = require('../../enums'),
    emailService = require('./email.service'),
    helperFunctions = require('../../helper-functions');

router.post('/otp/send/:type', (req, res) => {
    const otp = helperFunctions.generateOTP();
    const {type} = req.params;
    const {username} = req.body;
    if (!username)
        return res.send({
            "status": 500,
            "error": "Required parameter(s) not sent!",
            "response": null
        });

    let user = {};
    user.token = jwt.sign(
        {
            username: username,
            otp: otp
        },
        process.env.SECRET_KEY,
        {
            expiresIn: 60 * 60 * 24
        }
    );
    user.tenant = process.env.TENANT;
    user.environment = process.env.STATUS;

    switch (type) {
        case 'phone': {
            let sms = {
                phone: helperFunctions.formatToNigerianPhone(username),
                message: `To continue your signup, use this OTP ${helperFunctions.formatOTP(otp)}`
            }
            helperFunctions.sendSMS(sms, data => {
                if (data.response.status === 'SUCCESS') {
                    return res.send({
                        "status": 200,
                        "error": null,
                        "response": user
                    });
                } else {
                    return res.send({
                        "status": 500,
                        "error": 'Error sending OTP!',
                        "response": null
                    });
                }
            });
            break;
        }
        case 'email': {
            emailService.send({
                to: username,
                subject: 'Email Confirmation',
                template: 'default',
                context: {
                    name: username,
                    message: `To verify your email address, kindly use this OTP: ${otp}`
                }
            });
            return res.send({
                "status": 200,
                "error": null,
                "response": user
            });
        }
    }
});

router.post('/otp/verify', helperFunctions.verifyJWT, (req, res) => {
    const {username, otp} = req.body;
    if (!username || !otp)
        return res.send({
            "status": 500,
            "error": "Required parameter(s) not sent!",
            "response": null
        });

    if (
        Number(req.user.otp) !== Number(otp) || 
        req.user.username !== username
    )
        return res.send({
            "status": 500,
            "error": "Invalid OTP!",
            "response": null
        });

    res.send({
        "status": 200,
        "error": null,
        "response": "OTP verified!"
    });
});

router.post('/create', (req, res) => {
    let payload = req.body,
        query = 'INSERT INTO users Set ?',
        query2 = 'SELECT * FROM users where username = ? or email = ? or phone = ?';
    payload.status = enums.USER.STATUS.ACTIVE;
    payload.date_created = moment().utcOffset('+0100').format('YYYY-MM-DD H:mm:ss a');
    if (!payload.username) payload.username = payload.email;
    if (!payload.firstname || !payload.lastname || !payload.phone || !payload.email || !payload.pin || !payload.password)
        return res.send({
            "status": 500,
            "error": "Required parameter(s) not sent!",
            "response": null
        });

    payload.pin = bcrypt.hashSync(payload.pin, parseInt(process.env.SALT_ROUNDS));
    payload.password = bcrypt.hashSync(payload.password, parseInt(process.env.SALT_ROUNDS));
    db.getConnection((err, connection) => {
        if (err) throw err;
        connection.query(query2, [payload.username, payload.email, payload.phone], (error, results) => {
            if (results && results[0]) {
                let duplicates = [];
                if (payload.email == results[0]['email']) duplicates.push('email');
                if (payload.phone == results[0]['phone']) duplicates.push('phone');
                return res.send({
                    "status": 500,
                    "error": `The ${duplicates[0] || payload.username} is already in use by another user!`,
                    "response": null
                });
            }
            connection.query(query, payload, error => {
                if (error) {
                    res.send({
                        "status": 500,
                        "error": error,
                        "response": null
                    });
                } else {
                    connection.query('SELECT * from users where id = (SELECT MAX(id) FROM users)', (error, user_) => {
                        if (!error) {
                            emailService.send({
                                to: payload.email,
                                subject: 'Welcome to Payfeer!',
                                template: 'default',
                                context: {
                                    name: payload.firstname,
                                    message: 'Your account has been created successfully!'
                                }
                            });
                            let user = user_[0];
                            user.token = jwt.sign({
                                id: user.id,
                                username: user.username,
                                firstname: user.firstname,
                                lastname: user.lastname,
                                email: user.email,
                                phone: user.phone,
                                type: user.type
                            },
                                process.env.SECRET_KEY,
                                {
                                    expiresIn: 60 * 60 * 24
                                });
                            user.tenant = process.env.TENANT;
                            user.environment = process.env.STATUS;
                            res.send({
                                "status": 200,
                                "error": null,
                                "response": user
                            })
                        } else {
                            res.send({
                                "status": 500,
                                "error": error,
                                "response": null
                            });
                        }
                        connection.release();
                    });
                }
            });
        });
    });
});

router.post('/login', (req, res) => {
    const username = req.body.username,
        password = req.body.password;
    if (!username || !password) return res.status(500).send('Required parameter(s) not sent!');

    const query = `SELECT * FROM users WHERE username = '${username}' OR email = '${username}' OR phone = '${username}'`;
    db.query(query, (error, users) => {
        if (error)
            return res.send({
                "status": 500,
                "error": error,
                "response": null
            });

        if (!users || !users[0])
            return res.send({
                "status": 500,
                "error": "Sorry, we can't find this information in our record!",
                "response": null
            });

        let user = users[0];
        if (user.status === enums.USER.STATUS.INACTIVE)
            return res.send({
                "status": 500,
                "error": "Your account has been disabled, Please contact the admin!",
                "response": null
            });

        if (bcrypt.compareSync(password, user.password)) {
            const current_time = Date.now();
            const expires_in = 60 * 60 * 24;
            const token = jwt.sign({
                id: user.id,
                username: user.username,
                firstname: user.firstname,
                lastname: user.lastname,
                email: user.email,
                phone: user.phone,
                type: user.type
            },
                process.env.SECRET_KEY,
                {
                    expiresIn: expires_in
                });
            user.token = {
                iat: current_time,
                exp: current_time + (expires_in * 1000),
                token
            };
            user.tenant = process.env.TENANT;
            user.environment = process.env.STATUS;
            res.send({
                "status": 200,
                "error": null,
                "response": user
            });
        } else {
            res.send({
                "status": 500,
                "error": "Password is incorrect!",
                "response": null
            });
        }
    });
});

router.get('/logout/:user_id', helperFunctions.verifyJWT, (req, res) => {
    delete req.user;
    return res.send({
        "status": 200,
        "error": null,
        "response": `User logged out successfully!`
    });
});

router.get('/users/get/:user_id', helperFunctions.verifyJWT, (req, res) => {
    let permission = '';
    if (req.user.type === enums.USER.TYPE.USER)
        permission = `id = ${req.user.id} AND`;
    let query_condition = `FROM users WHERE ${permission} status = ${enums.USER.STATUS.ACTIVE}`;
    let query = `SELECT id, CONCAT(firstname, ' ', lastname) fullname ${query_condition} ORDER by firstname asc`;
    db.query(query, async (error, users) => {
        if (error) return res.send({
            "status": 500,
            "error": error,
            "response": null
        });

        return res.send({
            "status": 200,
            "error": null,
            "response": users
        });
    });
});

router.get('/get/:user_id', helperFunctions.verifyJWT, (req, res) => {
    let query = `SELECT * FROM users WHERE id = ${req.params.user_id}`;
    db.query(query, async (error, user) => {
        if (error) return res.send({
            "status": 500,
            "error": error,
            "response": null
        });

        return res.send({
            "status": 200,
            "error": null,
            "response": user[0]
        });
    });
});

router.put('/update/:user_id', helperFunctions.verifyJWT, (req, res) => {
    let payload = req.body,
        query = `SELECT * FROM users WHERE id = ${req.params.user_id}`;
    db.query(query, (error, user) => {
        if (!user[0]) return res.send({
            "status": 500,
            "error": 'User does not exist!',
            "response": null
        });

        user = user[0];
        if (user.id) delete payload.id;
        if (user.email) delete payload.email;
        if (user.username) delete payload.username;
        if (user.password) delete payload.password;
        if (user.type) delete payload.type;
        if (user.status) delete payload.status;
        if (user.verification) delete payload.verification;
        if (user.date_created) delete payload.date_created;

        if (payload.pin) payload.pin = bcrypt.hashSync(payload.pin, parseInt(process.env.SALT_ROUNDS));
        // TO DO BVN VERIFICATION
        if (payload.bvn) payload.verification = enums.USER.VERIFICATION.VERIFIED;
        payload.date_modified = moment().utcOffset('+0100').format('YYYY-MM-DD H:mm:ss a');
        query = `UPDATE users SET ? WHERE id = ${req.params.user_id}`;
        db.query(query, payload, error => {
            if (error)
                return res.send({
                    "status": 500,
                    "error": error,
                    "response": null
                });

            let client = {
                ...user,
                ...payload
            };                
            client.token = jwt.sign({
                id: user.id,
                username: user.username,
                firstname: user.firstname,
                lastname: user.lastname,
                email: user.email,
                phone: user.phone,
                type: user.type
            },
                process.env.SECRET_KEY,
                {
                    expiresIn: 60 * 60 * 24
                });

            res.send({
                "status": 200,
                "error": null,
                "response": client,
                "message": "User details updated"
            });
        });
    });
});

router.get('/enable/:user_id', helperFunctions.verifyJWT, (req, res) => {
    let payload = {};
    payload.status = enums.USER.STATUS.ACTIVE;
    payload.date_modified = moment().utcOffset('+0100').format('YYYY-MM-DD H:mm:ss a');
    let query = `Update users SET ? where id = ${req.params.user_id}`;
    db.query(query, payload, error => {
        if (error)
            return res.send({
                "status": 500,
                "error": error,
                "response": null
            });

        emailService.send({
            to: req.user.email,
            subject: 'Account Enabled',
            template: 'default',
            context: {
                name: req.user.firstname,
                message: 'Your account has been enabled successfully!'
            }
        });
        res.send({
            "status": 200,
            "error": null,
            "response": "User enabled!"
        });
    });
});

router.delete('/disable/:user_id', helperFunctions.verifyJWT, (req, res) => {
    let payload = {};
    payload.status = enums.USER.STATUS.INACTIVE;
    payload.date_modified = moment().utcOffset('+0100').format('YYYY-MM-DD H:mm:ss a');
    let query = `Update users SET ? where id = ${req.params.user_id}`;
    db.query(query, payload, error => {
        if (error)
            return res.send({
                "status": 500,
                "error": error,
                "response": null
            });

        emailService.send({
            to: req.user.email,
            subject: 'Account Disabled',
            template: 'default',
            context: {
                name: req.user.firstname,
                message: 'Your account has been disabled successfully!'
            }
        });
        res.send({
            "status": 200,
            "error": null,
            "response": "User disabled!"
        });
    });
});

router.put('/change-password/:user_id', helperFunctions.verifyJWT, (req, res) => {
    let payload = {},
        query = `UPDATE users SET ? WHERE id = ${req.params.user_id}`;
    payload.password = bcrypt.hashSync(req.body.password, parseInt(process.env.SALT_ROUNDS));
    payload.date_modified = moment().utcOffset('+0100').format('YYYY-MM-DD H:mm:ss a');
    db.query(query, payload, error => {
        if (error) {
            res.send({ "status": 500, "error": error, "response": null });
        } else {
            res.send({ "status": 200, "error": null, "response": "User password updated!" });
        }
    });
});

router.post('/reset-password', (req, res) => {
    if (!req.body.username) return res.status(500).send('Required parameter(s) not sent!');
    let query = `SELECT id, firstname, email, status FROM users 
        WHERE username = '${req.body.username}' OR email = '${req.body.username}' OR phone = '${req.body.username}'`;
    db.query(query, (error, user_) => {
        if (error) return res.send({
            "status": 500,
            "error": error,
            "response": null
        });
        if (!user_ || !user_[0]) return res.send({
            "status": 500,
            "error": 'Sorry we can’t find this username in our record, please contact admin!',
            "response": null
        });

        let user = user_[0];
        if (user.status === 0) return res.send({
            "status": 500,
            "error": "User has been disabled!",
            "response": null
        });

        const password = Math.random().toString(36).slice(-8);
        let payload = {
            password: bcrypt.hashSync(password, parseInt(process.env.SALT_ROUNDS)),
            date_modified: moment().utcOffset('+0100').format('YYYY-MM-DD h:mm:ss a')
        };
        emailService.sendByDomain(process.env.MAILGUN_DOMAIN, {
            to: user.email,
            subject: 'Reset Password Request',
            template: 'default',
            context: {
                name: user.firstname,
                message: `To login to the app, use this password ${password}`
            }
        });

        db.query(`UPDATE users SET ? WHERE id = ${user.id}`, payload, error => {
            if (error)
                return res.send({
                    "status": 500,
                    "error": error,
                    "response": null
                });

            return res.send({
                "status": 200,
                "error": null,
                "response": `A default password has been sent to ${user.email}!`
            });
        });
    });
});

module.exports = router;