const email = {},
    db = require('../../db'),
    nodemailer = require('nodemailer'),
    hbs = require('nodemailer-express-handlebars'),
    mailgunTransport = require('nodemailer-mailgun-transport'),
    mailgunOptions = {
        auth: {
            api_key: process.env.MAILGUN_API_KEY,
            domain: process.env.MAILGUN_DOMAIN
        }
    },
    transport = mailgunTransport(mailgunOptions),
    options = {
        viewEngine: {
            extName: '.hbs',
            partialsDir: 'views/email',
            layoutsDir: 'views/email'
        },
        viewPath: 'views/email',
        extName: '.hbs'
    },
    transporter = nodemailer.createTransport(transport);
transporter.use('compile', hbs(options));

email.send = async mailOptions => {
    if (!mailOptions.to || !mailOptions.subject) return;
    const {email} = await new Promise(resolve => {
        const query = `SELECT email FROM users WHERE id = "${mailOptions.to}" OR email = "${mailOptions.to}" OR username = "${mailOptions.to}"`;
        db.query(query, (error, user) => resolve(user ? user[0] : {}));
    });
    if (!email) return console.log('Email recipient is required!');
    mailOptions.to = email;
    if (process.env.ADMIN_EMAIL) mailOptions.to = mailOptions.to.concat(`,${process.env.ADMIN_EMAIL}`);
    mailOptions.from = mailOptions.from || `${process.env.TENANT} <no-reply@${process.env.MAILGUN_DOMAIN}>`;
    transporter.sendMail(mailOptions, error => {
        if (error) console.log(error);
    });
};

module.exports = email;