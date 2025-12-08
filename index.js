require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');

const app = express();
const port = process.env.PORT || 3000;

// Middleware
app.use(cors({
    origin: "http://localhost:5173",
    credentials: true
}));
app.use(express.json());

// MongoDB URI
const uri = `mongodb+srv://${process.env.User_Name}:${process.env.MongoPassword}@cluster0.nivae1g.mongodb.net/?appName=Cluster0`;

const client = new MongoClient(uri, {
    serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
    }
});

// Root route
app.get('/', (req, res) => {
    res.send('Server is Running');
});

// Async function to run MongoDB operations
async function run() {
    try {
        // Connect MongoDB
        await client.connect();
        const db = client.db("GarmentsProductionDB");
        const productsCollection = db.collection("AllProducts");
        console.log("MongoDB connected successfully!");

        // Post Products
        app.post('/products', async (req, res) => {
            const newProduct = req.body;
            if (!newProduct || Object.keys(newProduct).length === 0) {
                return res.status(400).json({ message: 'Product data is required' });
            }

            try {
                const result = await productsCollection.insertOne(newProduct);
                res.status(201).json({
                    message: 'Product added successfully',
                    productId: result.insertedId
                });
            } catch (err) {
                res.status(500).json({ message: 'Failed to add product', error: err.message });
            }
        });

        // GET All Products
        app.get('/products', async (req, res) => {
            try {
                const products = await productsCollection.find().toArray();
                res.status(200).json(products);
            } catch (err) {
                res.status(500).json({ message: 'Failed to fetch products', error: err.message });
            }
        });

        // GET Latest 8 Products
        app.get('/latest-products', async (req, res) => {
            try {
                const products = await productsCollection.find().sort({ _id: -1 }).limit(8).toArray();
                res.status(200).json(products);
            } catch (err) {
                res.status(500).json({
                    message: 'Failed to fetch latest products',
                    error: err.message
                });
            }
        });

        // GET Product by ID
        app.get('/products/:id', async (req, res) => {
            const id = req.params.id;
            try {
                const product = await productsCollection.findOne({ _id: new ObjectId(id) });
                if (!product) {
                    return res.status(404).json({ message: 'Product not found' });
                }
                res.status(200).json(product);
            } catch (err) {
                res.status(500).json({ message: 'Failed to fetch product', error: err.message });
            }
        });

    } catch (err) {
        console.error('MongoDB connection error:', err);
    }
}

run().catch(console.dir);

// Start server
app.listen(port, () => {
    console.log(`Server running on port ${port}`);
});

module.exports = app;
