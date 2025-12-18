require('dotenv').config();
const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');

const app = express();
const port = process.env.PORT || 3000;

// Middleware
app.use(cors({
    origin: process.env.Origin,
    credentials: true
}));

app.use(express.json());
app.use(cookieParser());
app.post('/jwt', (req, res) => {
    const user = req.body;
    if (!user?.email) {
        return res.status(400).send({ message: 'Email required' });
    }
    const token = jwt.sign(user, process.env.JWT_SECRET, {
        expiresIn: '7d',
    });
    res
        .cookie('token', token, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
        })
        .send({ success: true });
});

app.post('/logout', (req, res) => {
    res
        .clearCookie('token', {
            httpOnly: true,
            secure: true,
            sameSite: 'lax',
        })
        .send({ success: true });
});

//  VERIFY JWT
const verifyJWT = (req, res, next) => {
    const token = req.cookies?.token;
    if (!token) return res.status(401).send({ message: 'Unauthorized' });

    jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
        if (err) return res.status(401).send({ message: 'Unauthorized' });
        req.user = decoded;
        next();
    });
};


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
        app.post('/user', verifyJWT, async (req, res) => {
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

        // GET User Check Admin
        app.get('/user/admin', async (req, res) => {
            try {
                const email = req.query.email;
                if (!email) {
                    return res.status(400).json({ message: "Email query is required" });
                }
                const user = await usersCollection.findOne({ email: email })
                if (!user) {
                    return res.status(404).json({ message: "User not found" });
                }
                return res.send({ admin: user?.role === 'Admin' })
            } catch (error) {
                console.error("Get User Error:", error);
                return res.status(500).json({
                    message: "Internal Server Error",
                    error: error.message
                });
            }
        });

        // GET Suspended status
        app.get('/user/suspended', async (req, res) => {
            try {
                const email = req.query.email;
                if (!email) return res.status(400).json({ message: "Email query is required" });

                const user = await usersCollection.findOne({ email });
                if (!user) return res.status(404).json({ message: "User not found" });

                // Always return JSON with suspended: true/false
                return res.status(200).json({
                    suspended: user.status === 'Suspended',
                    reason: user.suspendReason || "",
                    feedback: user.suspendFeedback || ""
                });

            } catch (error) {
                console.error("Get Suspended Error:", error);
                return res.status(500).json({ message: "Internal Server Error", error: error.message });
            }
        });

        app.patch('/user/update/:id', async (req, res) => {
            const id = req.params.id
            const { role, status, suspendReason, suspendFeedback } = req.body

            const updateDoc = {
                $set: {
                    role,
                    status,
                    updatedAt: new Date(),
                },
            }

            // If suspended → save reason & feedback
            if (status === 'suspended') {
                updateDoc.$set.suspendReason = suspendReason
                updateDoc.$set.suspendFeedback = suspendFeedback
            }

            const result = await usersCollection.updateOne(
                { _id: new ObjectId(id) },
                updateDoc
            )

            res.send({
                success: true,
                modifiedCount: result.modifiedCount,
            })
        }
        )

        // Post Products
        app.post('/products', async (req, res) => {
            const newProduct = req.body;

            if (!newProduct || Object.keys(newProduct).length === 0) {
                return res.status(400).json({ message: 'Product data is required' });
            }

            try {
                const product = {
                    ...newProduct,
                    showOnHome: newProduct.showOnHome || false,
                    createdAt: new Date()
                };

                const result = await productsCollection.insertOne(product);

                res.status(201).json({
                    message: 'Product added successfully',
                    productId: result.insertedId
                });
            } catch (err) {
                res.status(500).json({
                    message: 'Failed to add product',
                    error: err.message
                });
            }
        });

        // GET All Products
        app.get('/products', async (req, res) => {
            try {
                const products = await productsCollection.find().toArray();
                res.status(200).json(products);
            } catch (err) {
                res.status(500).json({
                    message: 'Failed to fetch products',
                    error: err.message
                });
            }
        });

        // GET Latest 8 Products
        app.get('/latest-products', async (req, res) => {
            try {
                const products = await productsCollection
                    .find({ showOnHome: true })
                    .sort({ createdAt: -1 })
                    .limit(8)
                    .toArray();

                res.send(products);
            } catch (err) {
                res.status(500).json({
                    message: 'Failed to fetch home products',
                    error: err.message
                });
            }
        });

        // GET Product by ID
        app.get('/products/:id', verifyJWT, async (req, res) => {
            const id = req.params.id;

            try {
                const product = await productsCollection.findOne({ _id: new ObjectId(id) });

                if (!product) {
                    return res.status(404).json({ message: 'Product not found' });
                }

                res.status(200).json(product);
            } catch (err) {
                res.status(500).json({
                    message: 'Failed to fetch product',
                    error: err.message
                });
            }
        });

        app.patch('/product/:id', verifyJWT, async (req, res) => {
            const id = req.params.id;
            const updatedData = req.body;

            try {
                const result = await productsCollection.updateOne(
                    { _id: new ObjectId(id) },
                    {
                        $set: {
                            ...updatedData,
                            updatedAt: new Date()
                        }
                    }
                );

                res.send({
                    success: true,
                    modifiedCount: result.modifiedCount
                });
            } catch (err) {
                res.status(500).json({
                    message: 'Failed to update product',
                    error: err.message
                });
            }
        });

        app.delete('/product/:id', verifyJWT, async (req, res) => {
            const id = req.params.id;

            try {
                const result = await productsCollection.deleteOne({
                    _id: new ObjectId(id)
                });

                if (result.deletedCount === 0) {
                    return res.status(404).json({ message: 'Product not found' });
                }

                res.send({
                    success: true,
                    message: 'Product deleted successfully'
                });
            } catch (err) {
                res.status(500).json({
                    message: 'Failed to delete product',
                    error: err.message
                });
            }
        });

        app.patch('/products/show-home/:id', verifyJWT, async (req, res) => {
            const id = req.params.id;
            const { showOnHome } = req.body;

            try {
                const result = await productsCollection.updateOne(
                    { _id: new ObjectId(id) },
                    { $set: { showOnHome } }
                );

                res.send({
                    success: true,
                    modifiedCount: result.modifiedCount
                });
            } catch (err) {
                res.status(500).json({
                    message: 'Failed to update showOnHome',
                    error: err.message
                });
            }
        });

        // Post Orders
        app.post('/orders', verifyJWT, async (req, res) => {
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

        // GET Orders status, email
        app.get("/orders", verifyJWT, async (req, res) => {
            try {
                const { status, email } = req.query;

                const query = {};

                // Filter by status
                if (status) {
                    query.status = status;
                }

                // Filter by user email 
                if (email) {
                    query.email = email;
                }

                const orders = await ordersCollection
                    .find(query)
                    .sort({ createdAt: -1 })
                    .toArray();

                res.status(200).json(orders);

            } catch (error) {
                console.error("Get Orders Error:", error);
                res.status(500).json({
                    message: "Failed to load orders",
                    error: error.message
                });
            }
        });

        app.get('/order/:id', verifyJWT, async (req, res) => {
            try {
                const orderId = req.params.id;

                if (!orderId) {
                    return res.status(400).json({ message: "Order ID is required" });
                }

                const order = await ordersCollection.findOne({ _id: new ObjectId(orderId) });

                if (!order) {
                    return res.status(404).json({ message: "Order not found" });
                }

                return res.status(200).json(order);

            } catch (error) {
                console.error("Get Order by ID Error:", error);
                return res.status(500).json({
                    message: "Internal Server Error",
                    error: error.message
                });
            }
        });

        // Delete Order by ID
        app.delete('/order/:id', verifyJWT, async (req, res) => {
            try {
                const orderId = req.params.id;

                if (!orderId) {
                    return res.status(400).json({ message: "Order ID is required" });
                }

                const result = await ordersCollection.deleteOne({ _id: new ObjectId(orderId) });

                if (result.deletedCount === 0) {
                    return res.status(404).json({ message: "Order not found or already deleted" });
                }

                return res.status(200).json({ message: "Order deleted successfully" });

            } catch (error) {
                console.error("Delete Order Error:", error);
                return res.status(500).json({
                    message: "Internal Server Error",
                    error: error.message
                });
            }
        });

        // UPDATE Order Status
        app.patch("/orders/:id", verifyJWT, async (req, res) => {
            const { id } = req.params;
            const { status, tracking } = req.body;

            if (!status && !tracking) {
                return res.status(400).json({
                    message: "Status or Tracking data is required"
                });
            }

            try {
                const updateDoc = {};

                //  Status update
                if (status) {
                    updateDoc.$set = {
                        status
                    };

                    if (status === "Approved") {
                        updateDoc.$set.approvedAt = new Date();
                    }
                }

                //  Tracking update
                if (tracking) {
                    updateDoc.$push = {
                        trackingHistory: {
                            ...tracking,
                            time: new Date()
                        }
                    };
                }

                const result = await ordersCollection.updateOne(
                    { _id: new ObjectId(id) },
                    updateDoc
                );

                if (result.matchedCount === 0) {
                    return res.status(404).json({ message: "Order not found" });
                }

                res.json({
                    success: true,
                    message: "Order updated successfully"
                });

            } catch (error) {
                res.status(500).json({
                    message: "Failed to update order",
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
