// Loads the environment variables from the .env file
require('dotenv').config();

let http = require('http'),
    express = require('express'),
    bodyParser = require('body-parser'),
    compression = require('compression'),
    session = require('client-sessions'),
    cookieParser = require('cookie-parser'),
    fileUpload = require('express-fileupload');

const app = express(),
    cors = require('cors'),
    card_service = require('./routes/service/card.service'),
    user_service = require('./routes/service/user.service'),
    index_service = require('./routes/service/index.service'),
    upload_service = require('./routes/service/upload.service'),
    wallet_service = require('./routes/service/wallet.service');
    
app.use(compression());    
app.engine('html', require('ejs').renderFile);
app.set('view engine', 'html');
app.use(bodyParser.json({
    limit: '50mb',
    extended: true,
    parameterLimit: 1000000
}));
app.use(bodyParser.urlencoded({
    limit: '50mb',
    extended: true,
    parameterLimit: 1000000
}));
app.use(express.static(__dirname + '/views'));
app.use(cookieParser());
app.use(fileUpload());
app.use(cors());

//Session 
app.use(session({
    cookieName: 'session',
    secret: 'eg[isfd-8yF9-7w2315df{}+Ijsli;;to8',
    duration: 30 * 60 * 1000,
    activeDuration: 5 * 60 * 1000,
    httpOnly: true,
    secure: true,
    ephemeral: true
}));

app.use((req, res, next) => {
    if (process.env.STATUS && process.env.STATUS !== 'test')
        req.HOST = `https://${req.get('host')}`;
    if (Number(req.headers['content-length']) > Number(process.env.FILE_SIZE_LIMIT))
        return res.status(413).send('File exceeds the maximum upload size limit!');
    next();
});

app.use('/', index_service);
app.use('/card', card_service);
app.use('/user', user_service);
app.use('/upload', upload_service);
app.use('/wallet', wallet_service);
app.use('/files', express.static(__dirname + '/files'));

// catch 404 and forward to error handler
app.use((req, res) => {
    res.status(404);

    if (req.accepts('html')) {
        return res.render('404', {
            url: req.url
        });
    }

    if (req.accepts('json')) {
        return res.send({
            error: 'Not found'
        });
    }

    res.type('txt').send('Not found');
});

app.get('/error', function(req, res) {
    console.log(req.query.error);
    res.render('404', {
        url: req.url,
        error: req.query.error
    });
});

module.exports = app;

let server = http.createServer(app);
server.listen(process.env.port || process.env.PORT || 4000, function () {
    console.log('server running on %s [%s]', process.env.PORT, process.env.STATUS);
});