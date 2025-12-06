const express = require('express');
const cors = require('cors');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

// Root route
app.get('/', (req, res) => {
    res.send('Server is Running');
});

async function run() {
    try {
     
        // GET All Products
        app.get('/Products', async (req, res) => {
           
        
        });

        // GET Product by ID
        app.get('/Products/id/:id', async (req, res) => {
          
        });

    } catch (error) {
        console.error(error);
    }
}

run();

module.exports = app;
