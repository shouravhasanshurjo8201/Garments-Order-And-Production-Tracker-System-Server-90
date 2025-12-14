require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');

const app = express();
const port = process.env.PORT || 3000;

// Middleware
app.use(cors({
    origin: process.env.Origin1,
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
        const db = client.db("GarmentsProductionDB");
        const productsCollection = db.collection("AllProducts");
        const usersCollection = db.collection("users");
        const ordersCollection = db.collection("Orders");
        console.log("MongoDB connected successfully!");

        // Save  User
        app.post('/user', async (req, res) => {
            try {
                const userData = req.body;
                if (!userData || !userData.email) {
                    return res.status(400).json({ message: "User email is required" });
                }

                userData.created_at = new Date().toISOString();
                userData.last_loggedIn = new Date().toISOString();
                const query = { email: userData.email };
                const alreadyExists = await usersCollection.findOne(query);

                // If user exists
                if (alreadyExists) {
                    const updateDoc = {
                        $set: {
                            last_loggedIn: new Date().toISOString(),
                            name: userData.name || alreadyExists.name,
                            role: userData.role || alreadyExists.role,
                            photoURL: userData.photoURL || alreadyExists.photoURL,
                        }
                    };

                    const result = await usersCollection.updateOne(query, updateDoc);
                    return res.status(200).json({
                        message: "User updated successfully",
                        updated: true,
                        result
                    });
                }

                const result = await usersCollection.insertOne(userData);
                return res.status(201).json({
                    message: "User created successfully",
                    created: true,
                    userId: result.insertedId
                });

            } catch (error) {
                console.error("User Save Error:", error);
                return res.status(500).json({
                    message: "Internal Server Error",
                    error: error.message
                });
            }
        });

        // GET User  Get User
        app.get('/users', async (req, res) => {
            try {

                const users = await usersCollection.find().toArray();
                if (!users) {
                    return res.status(404).json({ message: "Users not found" });
                }
                return res.status(200).json(users);
            } catch (error) {
                console.error("Get Users Error:", error);
                return res.status(500).json({
                    message: "Internal Server Error",
                    error: error.message
                });
            }
        });
        // GET User  Get User
        app.get('/user', async (req, res) => {
            try {
                const email = req.query.email;
                if (!email) {
                    return res.status(400).json({ message: "Email query is required" });
                }
                const user = await usersCollection.findOne({ email: email })
                if (!user) {
                    return res.status(404).json({ message: "User not found" });
                }
                return res.status(200).json(user);
            } catch (error) {
                console.error("Get User Error:", error);
                return res.status(500).json({
                    message: "Internal Server Error",
                    error: error.message
                });
            }
        });
        // Update User
        app.patch('/user', async (req, res) => {
            try {
                const { email, name, photoURL } = req.body;
                const result = await usersCollection.updateOne(
                    { email: email },
                    {
                        $set: {
                            name,
                            photoURL
                        }
                    }
                );

                return res.status(200).json({ message: "User updated successfully", result });

            } catch (error) {
                console.error("User Update Error:", error);
                return res.status(500).json({ message: "Error updating user", error: error.message });
            }
        });

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

        // Post Orders
        app.post('/orders', async (req, res) => {
            const orderData = req.body;

            if (!orderData || Object.keys(orderData).length === 0) {
                return res.status(400).json({ message: 'Orders data is required' });
            }

            try {
                const productId = orderData.productId;
                if (!productId) {
                    return res.status(400).json({ message: "Product ID is required" });
                }

                // ১) Get product from DB
                const product = await productsCollection.findOne({ _id: new ObjectId(productId) });
                if (!product) {
                    return res.status(404).json({ message: "Product not found" });
                }

                // ২) Check stock
                if (orderData.quantity > product.quantity) {
                    return res.status(400).json({ message: "Cannot order more than available stock" });
                }

                // ৩) Insert order
                orderData.createdAt = new Date().toISOString();
                const result = await ordersCollection.insertOne(orderData);

                // ৪) Update product quantity
                const newQuantity = product.quantity - Number(orderData.quantity);
                await productsCollection.updateOne(
                    { _id: new ObjectId(productId) },
                    { $set: { quantity: newQuantity } }
                );

                res.status(201).json({
                    message: "Order placed successfully",
                    orderId: result.insertedId,
                    updatedProductQuantity: newQuantity
                });

            } catch (err) {
                console.error("Order creation failed:", err);
                res.status(500).json({ message: "Failed to create order", error: err.message });
            }
        });

        // GET All Orders (Admin)
        app.get('/orders', async (req, res) => {
            try {
                const orders = await ordersCollection.find().toArray();

                if (!orders || orders.length === 0) {
                    return res.status(404).json({
                        message: "No orders found"
                    });
                }

                res.status(200).json(orders);

            } catch (error) {
                console.error("Get All Orders Error:", error);
                res.status(500).json({
                    message: "Internal Server Error",
                    error: error.message
                });
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
