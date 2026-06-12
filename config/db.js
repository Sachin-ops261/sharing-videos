require('dotenv').config();
const {Pool} = require('pg');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
});

pool.connect((err, client, release) =>{
    if(err){
        return console.error("X error acquiring client", err.stack);
    }
    console.log("seccessfully connected to the postgreSQL database live in the cloud!");
    release();
});

module.exports = pool;