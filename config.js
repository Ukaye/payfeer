
let config = {};

config.staging = {
    host: '3.16.69.31',
    port: '3306',
    user: 'finsoftapp',
    password: 'LibertaDev@Finsoftapp2020',
    database: 'payfeer',
    charset: 'utf8mb4',
    insecureAuth: true
};

config.production = {
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    charset: 'utf8mb4',
    insecureAuth: true
};

module.exports = config;