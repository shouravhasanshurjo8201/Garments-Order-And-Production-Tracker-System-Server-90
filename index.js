require('dotenv').config();
const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');
const { GoogleGenerativeAI } = require("@google/generative-ai");
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');

const app = express();
const port = process.env.PORT || 3000;
app.set('trust proxy', 1);

// MIDDLEWARE
app.use(cors({
    origin: [
        'http://localhost:5173',
        'https://garments-production-tracker-system-69.netlify.app',
        'https://garments-production-tracker-system-92.netlify.app'
    ],
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]
}));

app.use(express.json());
app.use(cookieParser());

// ==========================================
// GEMINI AI SETUP
// ==========================================
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// ==========================================
// MONGODB CONNECTION
// ==========================================
const uri = `mongodb+srv://${process.env.User_Name}:${process.env.MongoPassword}@cluster0.nivae1g.mongodb.net/?appName=Cluster0`;

const client = new MongoClient(uri, {
    serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
    }
});

// ROOT ROUTE
app.get('/', (req, res) => {
    res.send('Garments Tracker Server is Running ✅');
});

// MAIN ASYNC FUNCTION
async function run() {
    try {
        // Explicit connection establish
        await client.connect();
        
        const db = client.db("GarmentsProductionDB");
        const productsCollection = db.collection("AllProducts");
        const usersCollection = db.collection("users");
        const ordersCollection = db.collection("Orders");
        const knowledgeCollection = db.collection("KnowledgeBase");

        console.log("✅ MongoDB connected successfully!");

        // JWT & AUTH MIDDLEWARES
        const verifyJWT = (req, res, next) => {
            const token = req.cookies?.token;

            if (!token) {
                console.log("Token not found in cookies");
                return res.status(401).send({ message: 'Unauthorized: No token provided' });
            }

            jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
                if (err) {
                    console.log("JWT Verification Error:", err.message);
                    return res.status(403).send({ message: 'Forbidden: Invalid or Expired token' });
                }
                req.user = decoded;
                next();
            });
        };

        // Admin verification middleware to ensure only Admins can access certain routes
        const verifyAdmin = async (req, res, next) => {
            const email = req.user?.email;
            const query = { email: email };
            const user = await usersCollection.findOne(query);
            const isAdmin = user?.role === 'Admin';
            if (!isAdmin) {
                return res.status(403).send({ message: 'Forbidden access! Admin only.' });
            }
            next();
        };

        // AUTH ROUTES

        // POST - Login & Sync User, Generate JWT Cookie
        app.post('/login-user', async (req, res) => {
            try {
                const userData = req.body;
                if (!userData?.email) {
                    return res.status(400).send({ message: 'Email required' });
                }

                const token = jwt.sign(
                    { email: userData.email },
                    process.env.JWT_SECRET,
                    { expiresIn: '7d' }
                );

                const query = { email: userData.email };
                const alreadyExists = await usersCollection.findOne(query);

                if (alreadyExists) {
                    await usersCollection.updateOne(query, {
                        $set: {
                            last_loggedIn: new Date().toISOString(),
                            name: userData.name || alreadyExists.name,
                            photoURL: userData.photoURL || alreadyExists.photoURL,
                        }
                    });
                } else {
                    userData.created_at = new Date().toISOString();
                    userData.last_loggedIn = new Date().toISOString();
                    userData.role = userData.role || 'User';
                    await usersCollection.insertOne(userData);
                }

                res.cookie('token', token, {
                    httpOnly: true,
                    secure: process.env.NODE_ENV === 'production',
                    sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
                    maxAge: 7 * 24 * 60 * 60 * 1000
                }).send({ success: true, message: "Login & User sync successful" });

            } catch (error) {
                console.error("Login Error:", error);
                res.status(500).send({ message: 'Internal Server Error' });
            }
        });

        // POST - Logout (clear JWT cookie)
        app.post('/logout', (req, res) => {
            res.clearCookie('token', {
                httpOnly: true,
                secure: process.env.NODE_ENV === 'production',
                sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
            }).send({ success: true });
        });

        // USER ROUTES

        // GET - All Users (Admin Protected - Fixed with verifyAdmin)
        app.get('/users', verifyJWT, verifyAdmin, async (req, res) => {
            try {
                const users = await usersCollection.find().toArray();
                return res.status(200).json(users);
            } catch (error) {
                console.error("Get Users Error:", error);
                return res.status(500).json({ message: "Internal Server Error", error: error.message });
            }
        });

        // GET - Single User (Protected)
        app.get('/user', verifyJWT, async (req, res) => {
            try {
                const email = req.query.email;
                if (!email) return res.status(400).json({ message: "Email query is required" });

                const user = await usersCollection.findOne({ email });
                if (!user) return res.status(404).json({ message: "User not found" });

                return res.status(200).json(user);
            } catch (error) {
                console.error("Get User Error:", error);
                return res.status(500).json({ message: "Internal Server Error", error: error.message });
            }
        });

        // GET - Check Admin Status (Protected)
        app.get('/user/admin', verifyJWT, async (req, res) => {
            try {
                const email = req.query.email;
                if (!email) return res.status(400).json({ message: "Email query is required" });

                const user = await usersCollection.findOne({ email });
                if (!user) return res.status(404).json({ message: "User not found" });

                return res.send({ admin: user?.role === 'Admin' });
            } catch (error) {
                console.error("Admin Check Error:", error);
                return res.status(500).json({ message: "Internal Server Error", error: error.message });
            }
        });

        // GET - Check Suspended Status (Public)
        app.get('/user/suspended', async (req, res) => {
            try {
                const email = req.query.email;
                if (!email) return res.status(400).json({ message: "Email query is required" });

                const user = await usersCollection.findOne({ email });
                if (!user) return res.status(404).json({ message: "User not found" });

                return res.status(200).json({
                    suspended: user.status === 'Suspended',
                    reason: user.suspendReason || "",
                    feedback: user.suspendFeedback || ""
                });
            } catch (error) {
                console.error("Suspended Check Error:", error);
                return res.status(500).json({ message: "Internal Server Error", error: error.message });
            }
        });

        // PATCH - Update User Role & Status (Admin Protected - Fixed with verifyAdmin)
        app.patch('/user/update/:id', verifyJWT, verifyAdmin, async (req, res) => {
            try {
                const id = req.params.id;
                if (!ObjectId.isValid(id)) {
                    return res.status(400).json({ message: 'Invalid User ID format' });
                }
                const { role, status, suspendReason, suspendFeedback } = req.body;

                const updateDoc = {
                    $set: {
                        role,
                        status,
                        updatedAt: new Date(),
                    }
                };

                if (status === 'Suspended') {
                    updateDoc.$set.suspendReason = suspendReason;
                    updateDoc.$set.suspendFeedback = suspendFeedback;
                }

                const result = await usersCollection.updateOne(
                    { _id: new ObjectId(id) },
                    updateDoc
                );

                res.send({ success: true, modifiedCount: result.modifiedCount });
            } catch (error) {
                res.status(500).json({ message: "Update failed", error: error.message });
            }
        });

        // PRODUCTS ROUTES

        // POST - Add Product (Protected)
        app.post('/products', verifyJWT, async (req, res) => {
            try {
                const newProduct = req.body;
                if (!newProduct || Object.keys(newProduct).length === 0) {
                    return res.status(400).json({ message: 'Product data is required' });
                }

                const product = {
                    ...newProduct,
                    quantity: Number(newProduct.quantity) || 0, // Ensure numeric format
                    showOnHome: newProduct.showOnHome || false,
                    createdAt: new Date()
                };

                const result = await productsCollection.insertOne(product);
                res.status(201).json({ message: 'Product added successfully', productId: result.insertedId });
            } catch (err) {
                res.status(500).json({ message: 'Failed to add product', error: err.message });
            }
        });

        // GET - All Products (Public)
        app.get('/products', async (req, res) => {
            try {
                const products = await productsCollection.find().toArray();
                res.status(200).json(products);
            } catch (err) {
                res.status(500).json({ message: 'Failed to fetch products', error: err.message });
            }
        });

        // GET - Latest Products for Home (Public)
        app.get('/latest-products', async (req, res) => {
            try {
                const products = await productsCollection
                    .find({ showOnHome: true })
                    .sort({ createdAt: -1 })
                    .toArray();
                res.send(products);
            } catch (err) {
                res.status(500).json({ message: 'Failed to fetch home products', error: err.message });
            }
        });

        // GET - Single Product by ID (Public)
        app.get('/products/:id', async (req, res) => {
            try {
                const id = req.params.id;
                if (!ObjectId.isValid(id)) return res.status(400).json({ message: 'Invalid Product ID format' });
                const product = await productsCollection.findOne({ _id: new ObjectId(id) });
                if (!product) return res.status(404).json({ message: 'Product not found' });
                res.status(200).json(product);
            } catch (err) {
                res.status(500).json({ message: 'Failed to fetch product', error: err.message });
            }
        });

        // PATCH - Update Product (Protected)
        app.patch('/product/:id', verifyJWT, async (req, res) => {
            try {
                const id = req.params.id;
                if (!ObjectId.isValid(id)) return res.status(400).json({ message: 'Invalid Product ID format' });
                
                const updateData = { ...req.body };
                if(updateData.quantity) updateData.quantity = Number(updateData.quantity);

                const result = await productsCollection.updateOne(
                    { _id: new ObjectId(id) },
                    { $set: { ...updateData, updatedAt: new Date() } }
                );
                res.send({ success: true, modifiedCount: result.modifiedCount });
            } catch (err) {
                res.status(500).json({ message: 'Failed to update product', error: err.message });
            }
        });

        // PATCH - Toggle showOnHome (Protected)
        app.patch('/products/show-home/:id', verifyJWT, async (req, res) => {
            try {
                const id = req.params.id;
                if (!ObjectId.isValid(id)) return res.status(400).json({ message: 'Invalid Product ID format' });
                const { showOnHome } = req.body;
                const result = await productsCollection.updateOne(
                    { _id: new ObjectId(id) },
                    { $set: { showOnHome } }
                );
                res.send({ success: true, modifiedCount: result.modifiedCount });
            } catch (err) {
                res.status(500).json({ message: 'Failed to update showOnHome', error: err.message });
            }
        });

        // DELETE - Delete Product (Protected)
        app.delete('/product/:id', verifyJWT, async (req, res) => {
            try {
                const id = req.params.id;
                if (!ObjectId.isValid(id)) return res.status(400).json({ message: 'Invalid Product ID format' });
                const result = await productsCollection.deleteOne({ _id: new ObjectId(id) });
                if (result.deletedCount === 0) return res.status(404).json({ message: 'Product not found' });
                res.send({ success: true, message: 'Product deleted successfully' });
            } catch (err) {
                res.status(500).json({ message: 'Failed to delete product', error: err.message });
            }
        });

        // ORDERS ROUTES

        // POST - Place Order with Stock Deduction (Protected)
        app.post('/orders', verifyJWT, async (req, res) => {
            try {
                const orderData = req.body;
                if (!orderData || Object.keys(orderData).length === 0) {
                    return res.status(400).json({ message: 'Order data is required' });
                }

                const { productId, quantity } = orderData;
                if (!productId) return res.status(400).json({ message: "Product ID is required" });
                if (!ObjectId.isValid(productId)) return res.status(400).json({ message: "Invalid Product ID format" });

                const product = await productsCollection.findOne({ _id: new ObjectId(productId) });
                if (!product) return res.status(404).json({ message: "Product not found" });

                const orderQty = Number(quantity);
                if (isNaN(orderQty) || orderQty <= 0) {
                    return res.status(400).json({ message: "Invalid quantity value" });
                }
                if (orderQty > product.quantity) {
                    return res.status(400).json({ message: "Cannot order more than available stock" });
                }

                orderData.createdAt = new Date();
                orderData.productId = new ObjectId(productId); 
                
                const result = await ordersCollection.insertOne(orderData);

                const newQuantity = product.quantity - orderQty;
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

        // GET - All Orders with optional status/email filter (Protected)
        app.get('/orders', verifyJWT, async (req, res) => {
            try {
                const { status, email } = req.query;
                const query = {};
                if (status) query.status = status;
                if (email) query.email = email;

                const orders = await ordersCollection
                    .find(query)
                    .sort({ createdAt: -1 })
                    .toArray();

                res.status(200).json(orders);
            } catch (error) {
                console.error("Get Orders Error:", error);
                res.status(500).json({ message: "Failed to load orders", error: error.message });
            }
        });

        // GET - Monthly Report Data for PDF (Protected)
        app.get('/orders/monthly-report', verifyJWT, async (req, res) => {
            try {
                const { month, year } = req.query;
                if (!month || !year) {
                    return res.status(400).json({ message: "Month and Year queries are required" });
                }

                const startIsoString = `${year}-${month}-01T00:00:00.000Z`;

                let nextMonth = parseInt(month) + 1;
                let nextYear = parseInt(year);
                if (nextMonth > 12) { nextMonth = 1; nextYear += 1; }
                const formattedNextMonth = String(nextMonth).padStart(2, '0');
                const endIsoString = `${nextYear}-${formattedNextMonth}-01T00:00:00.000Z`;

                const monthlyOrders = await ordersCollection
                    .find({ createdAt: { $gte: new Date(startIsoString), $lt: new Date(endIsoString) } })
                    .sort({ createdAt: 1 })
                    .toArray();

                res.status(200).json(monthlyOrders);
            } catch (error) {
                console.error("Monthly Report Error:", error);
                res.status(500).json({ message: "Internal Server Error", error: error.message });
            }
        });

        // GET - Single Order by ID (Protected)
        app.get('/order/:id', verifyJWT, async (req, res) => {
            try {
                const id = req.params.id;
                if (!ObjectId.isValid(id)) return res.status(400).json({ message: "Invalid Order ID format" });
                const order = await ordersCollection.findOne({ _id: new ObjectId(id) });
                if (!order) return res.status(404).json({ message: "Order not found" });
                return res.status(200).json(order);
            } catch (error) {
                console.error("Get Order Error:", error);
                return res.status(500).json({ message: "Internal Server Error", error: error.message });
            }
        });

        // PATCH - Update Order Status & Tracking (Protected)
        app.patch('/orders/:id', verifyJWT, async (req, res) => {
            try {
                const id = req.params.id;
                if (!ObjectId.isValid(id)) return res.status(400).json({ message: "Invalid Order ID format" });
                const { status, tracking, coordinates } = req.body;
                const updateDoc = { $set: {}, $push: {} };

                if (status) {
                    updateDoc.$set.status = status;
                    if (status === "Approved") updateDoc.$set.approvedAt = new Date();
                }

                if (coordinates) {
                    updateDoc.$set.coordinates = coordinates;
                    updateDoc.$set.location = tracking?.location;
                }

                if (tracking) {
                    updateDoc.$push.trackingHistory = { ...tracking, time: new Date() };
                }

                if (Object.keys(updateDoc.$set).length === 0) delete updateDoc.$set;
                if (Object.keys(updateDoc.$push).length === 0) delete updateDoc.$push;

                const result = await ordersCollection.updateOne(
                    { _id: new ObjectId(id) },
                    updateDoc
                );

                if (result.matchedCount === 0) return res.status(404).json({ message: "Order not found" });

                res.json({ success: true, message: "Order updated successfully" });
            } catch (error) {
                res.status(500).json({ message: "Failed to update order", error: error.message });
            }
        });

        // DELETE - Delete Order by ID (Protected)
        app.delete('/order/:id', verifyJWT, async (req, res) => {
            try {
                const id = req.params.id;
                if (!ObjectId.isValid(id)) return res.status(400).json({ message: "Invalid Order ID format" });
                const result = await ordersCollection.deleteOne({ _id: new ObjectId(id) });
                if (result.deletedCount === 0) return res.status(404).json({ message: "Order not found or already deleted" });
                return res.status(200).json({ message: "Order deleted successfully" });
            } catch (error) {
                console.error("Delete Order Error:", error);
                return res.status(500).json({ message: "Internal Server Error", error: error.message });
            }
        });

        // AI CHATBOT ROUTE (Protected)
        app.post('/chat', verifyJWT, async (req, res) => {
            try {
                const { message, history } = req.body;
                if (!message || message.trim() === "") {
                    return res.status(400).json({ error: "Message missing" });
                }

                const config = await knowledgeCollection.findOne({ type: "instruction" });
                const systemPrompt = config?.content || "You are an expert assistant for the Garments Production Tracker System.";

                let knowledgeData = [];
                try {
                    knowledgeData = await knowledgeCollection
                        .find({ $text: { $search: message } })
                        .limit(3)
                        .toArray();
                } catch {
                    knowledgeData = await knowledgeCollection
                        .find({
                            $or: [
                                { question: { $regex: message, $options: "i" } },
                                { answer: { $regex: message, $options: "i" } }
                            ]
                        })
                        .limit(3)
                        .toArray();
                }

                const hasKnowledge = knowledgeData.length > 0;
                const knowledgeText = hasKnowledge
                    ? knowledgeData.map(k => `Q: ${k.question}\nA: ${k.answer}`).join("\n\n")
                    : null;

                const fullSystemInstruction = knowledgeText
                    ? `${systemPrompt}\n\nRelevant context for this session:\n${knowledgeText}`
                    : systemPrompt;

                const model = genAI.getGenerativeModel({
                    model: "gemini-2.5-flash",
                    systemInstruction: fullSystemInstruction
                });

                const rawHistory = Array.isArray(history) ? history : [];
                const cleanHistory = rawHistory
                    .filter(msg => (msg.role === "user" || msg.role === "model") && msg.parts?.[0]?.text?.trim() !== "");

                while (cleanHistory.length > 0 && cleanHistory[0].role !== "user") {
                    cleanHistory.shift();
                }

                const validHistory = [];
                for (const msg of cleanHistory) {
                    if (validHistory.length === 0 || validHistory[validHistory.length - 1].role !== msg.role) {
                        validHistory.push(msg);
                    }
                }

                const chat = model.startChat({ history: validHistory });
                const result = await chat.sendMessage(message);
                res.json({ reply: result.response.text() });

            } catch (error) {
                console.error("AI Chat Error:", error);
                res.status(500).json({ error: "AI Error", details: error.message });
            }
        });

        // AI JOB DESCRIPTION GENERATOR (Protected)
        app.post('/generate-job-description', verifyJWT, async (req, res) => {
            try {
                const { jobTitle, department, skills, experience, jobType } = req.body;
                if (!jobTitle || !skills) {
                    return res.status(400).json({ error: "Job Title and Skills are required" });
                }

                const prompt = `
                    Create a professional, highly engaging, and well-structured Job Description based on the following details:
                    - Job Title: ${jobTitle}
                    - Department/Industry: ${department || 'Not specified'}
                    - Required Skills: ${skills}
                    - Experience Required: ${experience || 'Not specified'}
                    - Job Type: ${jobType} (e.g., Full-time, Remote, Hybrid)
                    
                    The output must include these sections structured beautifully:
                    1. Job Summary
                    2. Core Responsibilities (using bullet points)
                    3. Requirements & Skills (using bullet points)
                    4. Benefits & Perks (generic professional ones)
                    
                    Format the output using clear markdown headers.
                `.trim();

                const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
                const result = await model.generateContent(prompt);

                res.status(200).json({ success: true, description: result.response.text() });
            } catch (error) {
                console.error("Job Description Error:", error);
                res.status(500).json({ success: false, error: "AI Generation Failed", details: error.message });
            }
        });

        // ADMIN — AI CONFIG & KNOWLEDGE BASE (Admin Protected - Fixed)

        // POST - Update AI System Prompt
        app.post('/admin/ai-config', verifyJWT, verifyAdmin, async (req, res) => {
            const { content } = req.body;
            if (!content) return res.status(400).json({ error: "Content required" });

            await knowledgeCollection.updateOne(
                { type: "instruction" },
                { $set: { content, updatedAt: new Date() } },
                { upsert: true }
            );
            res.json({ success: true });
        });

        // POST - Add Knowledge Base Q&A
        app.post('/admin/add-knowledge', verifyJWT, verifyAdmin, async (req, res) => {
            const { question, answer } = req.body;
            if (!question || !answer) return res.status(400).json({ error: "Question and Answer are required" });

            const result = await knowledgeCollection.insertOne({ question, answer, type: "qa", createdAt: new Date() });
            res.json({ success: true, id: result.insertedId });
        });

    } catch (err) {
        console.error('❌ MongoDB connection error:', err);
    }
}

run().catch(console.dir);

// START SERVER
app.listen(port, () => {
    console.log(`🚀 Garments Tracker Server listening on port ${port}`);
});

module.exports = app;



// require('dotenv').config();
// const express = require('express');
// const cors = require('cors');
// const jwt = require('jsonwebtoken');
// const cookieParser = require('cookie-parser');
// const { GoogleGenerativeAI } = require("@google/generative-ai");
// const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');

// const app = express();
// const port = process.env.PORT || 3000;
// app.set('trust proxy', 1);
// // Middleware
// app.use(cors({
//     origin: [
//         'http://localhost:5173',
//         'https://garments-production-tracker-system-69.netlify.app',
//         'https://garments-production-tracker-system-92.netlify.app'
//     ],
//     credentials: true,
//     methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]
// }));

// app.use(express.json());
// app.use(cookieParser());

// //  VERIFY JWT
// const verifyJWT = (req, res, next) => {
//     const token = req.cookies?.token;

//     if (!token) {
//         console.log("Token not found in cookies");
//         return res.status(401).send({ message: 'Unauthorized: No token provided' });
//     }

//     jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
//         if (err) {
//             console.log("JWT Verification Error:", err.message);
//             return res.status(403).send({ message: 'Forbidden: Invalid or Expired token' });
//         }
//         req.user = decoded;
//         next();
//     });
// };
// // Gemini AI Setup
// const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
// // MongoDB URI
// const uri = `mongodb+srv://${process.env.User_Name}:${process.env.MongoPassword}@cluster0.nivae1g.mongodb.net/?appName=Cluster0`;

// const client = new MongoClient(uri, {
//     serverApi: {
//         version: ServerApiVersion.v1,
//         strict: true,
//         deprecationErrors: true,
//     }
// });

// // Root route
// app.get('/', (req, res) => {
//     res.send('Server is Running');
// });

// // Async function to run MongoDB operations
// async function run() {
//     try {
//         // Connect MongoDB
//         const db = client.db("GarmentsProductionDB");
//         const productsCollection = db.collection("AllProducts");
//         const usersCollection = db.collection("users");
//         const ordersCollection = db.collection("Orders");
//         const knowledgeCollection = db.collection("KnowledgeBase");
//         console.log("MongoDB connected successfully!");

//         // Save  User
//         app.post('/login-user', async (req, res) => {
//             try {
//                 const userData = req.body;
//                 if (!userData?.email) {
//                     return res.status(400).send({ message: 'Email required' });
//                 }

//                 const token = jwt.sign({ email: userData.email }, process.env.JWT_SECRET, {
//                     expiresIn: '7d',
//                 });

//                 const query = { email: userData.email };
//                 const alreadyExists = await usersCollection.findOne(query);

//                 if (alreadyExists) {
//                     let updateDoc = {
//                         $set: {
//                             last_loggedIn: new Date().toISOString(),
//                             name: userData.name || alreadyExists.name,
//                             photoURL: userData.photoURL || alreadyExists.photoURL,
//                         }
//                     };
//                     await usersCollection.updateOne(query, updateDoc);
//                 } else {
//                     userData.created_at = new Date().toISOString();
//                     userData.last_loggedIn = new Date().toISOString();
//                     await usersCollection.insertOne(userData);
//                 }

//                 res.cookie('token', token, {
//                     httpOnly: true,
//                     secure: process.env.NODE_ENV === 'production',
//                     sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
//                     maxAge: 7 * 24 * 60 * 60 * 1000
//                 }).send({
//                     success: true,
//                     message: "Login & User sync successful"
//                 });

//             } catch (error) {
//                 console.error(error);
//                 res.status(500).send({ message: 'Internal Server Error' });
//             }
//         });

//         app.post('/logout', (req, res) => {
//             res.clearCookie('token', {
//                 httpOnly: true,
//                 secure: process.env.NODE_ENV === 'production',
//                 sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
//             }).send({ success: true });
//         });

//         // GET User  Get User
//         app.get('/users', async (req, res) => {
//             try {

//                 const users = await usersCollection.find().toArray();
//                 if (!users) {
//                     return res.status(404).json({ message: "Users not found" });
//                 }
//                 return res.status(200).json(users);
//             } catch (error) {
//                 console.error("Get Users Error:", error);
//                 return res.status(500).json({
//                     message: "Internal Server Error",
//                     error: error.message
//                 });
//             }
//         });

//         // GET User  Get User
//         app.get('/user', async (req, res) => {
//             try {
//                 const email = req.query.email;
//                 if (!email) {
//                     return res.status(400).json({ message: "Email query is required" });
//                 }
//                 const user = await usersCollection.findOne({ email: email })
//                 if (!user) {
//                     return res.status(404).json({ message: "User not found" });
//                 }
//                 return res.status(200).json(user);
//             } catch (error) {
//                 console.error("Get User Error:", error);
//                 return res.status(500).json({
//                     message: "Internal Server Error",
//                     error: error.message
//                 });
//             }
//         });

//         // GET User Check Admin
//         app.get('/user/admin', async (req, res) => {
//             try {
//                 const email = req.query.email;
//                 if (!email) {
//                     return res.status(400).json({ message: "Email query is required" });
//                 }
//                 const user = await usersCollection.findOne({ email: email })
//                 if (!user) {
//                     return res.status(404).json({ message: "User not found" });
//                 }
//                 return res.send({ admin: user?.role === 'Admin' })
//             } catch (error) {
//                 console.error("Get User Error:", error);
//                 return res.status(500).json({
//                     message: "Internal Server Error",
//                     error: error.message
//                 });
//             }
//         });

//         // GET Suspended status
//         app.get('/user/suspended', async (req, res) => {
//             try {
//                 const email = req.query.email;
//                 if (!email) return res.status(400).json({ message: "Email query is required" });

//                 const user = await usersCollection.findOne({ email });
//                 if (!user) return res.status(404).json({ message: "User not found" });

//                 // Always return JSON with suspended: true/false
//                 return res.status(200).json({
//                     suspended: user.status === 'Suspended',
//                     reason: user.suspendReason || "",
//                     feedback: user.suspendFeedback || ""
//                 });

//             } catch (error) {
//                 console.error("Get Suspended Error:", error);
//                 return res.status(500).json({ message: "Internal Server Error", error: error.message });
//             }
//         });

//         app.patch('/user/update/:id', async (req, res) => {
//             const id = req.params.id
//             const { role, status, suspendReason, suspendFeedback } = req.body

//             const updateDoc = {
//                 $set: {
//                     role,
//                     status,
//                     updatedAt: new Date(),
//                 },
//             }

//             // If suspended → save reason & feedback
//             if (status === 'suspended') {
//                 updateDoc.$set.suspendReason = suspendReason
//                 updateDoc.$set.suspendFeedback = suspendFeedback
//             }

//             const result = await usersCollection.updateOne(
//                 { _id: new ObjectId(id) },
//                 updateDoc
//             )

//             res.send({
//                 success: true,
//                 modifiedCount: result.modifiedCount,
//             })
//         }
//         )

//         // Post Products
//         app.post('/products', async (req, res) => {
//             const newProduct = req.body;

//             if (!newProduct || Object.keys(newProduct).length === 0) {
//                 return res.status(400).json({ message: 'Product data is required' });
//             }

//             try {
//                 const product = {
//                     ...newProduct,
//                     showOnHome: newProduct.showOnHome || false,
//                     createdAt: new Date()
//                 };

//                 const result = await productsCollection.insertOne(product);

//                 res.status(201).json({
//                     message: 'Product added successfully',
//                     productId: result.insertedId
//                 });
//             } catch (err) {
//                 res.status(500).json({
//                     message: 'Failed to add product',
//                     error: err.message
//                 });
//             }
//         });

//         // GET All Products
//         app.get('/products', async (req, res) => {
//             try {
//                 const products = await productsCollection.find().toArray();
//                 res.status(200).json(products);
//             } catch (err) {
//                 res.status(500).json({
//                     message: 'Failed to fetch products',
//                     error: err.message
//                 });
//             }
//         });

//         // GET Latest 8 Products
//         app.get('/latest-products', async (req, res) => {
//             try {
//                 const products = await productsCollection
//                     .find({ showOnHome: true })
//                     .sort({ createdAt: -1 })
//                     .toArray();

//                 res.send(products);
//             } catch (err) {
//                 res.status(500).json({
//                     message: 'Failed to fetch home products',
//                     error: err.message
//                 });
//             }
//         });

//         // GET Product by ID
//         app.get('/products/:id', async (req, res) => {
//             const id = req.params.id;

//             try {
//                 const product = await productsCollection.findOne({ _id: new ObjectId(id) });

//                 if (!product) {
//                     return res.status(404).json({ message: 'Product not found' });
//                 }

//                 res.status(200).json(product);
//             } catch (err) {
//                 res.status(500).json({
//                     message: 'Failed to fetch product',
//                     error: err.message
//                 });
//             }
//         });

//         app.patch('/product/:id', async (req, res) => {
//             const id = req.params.id;
//             const updatedData = req.body;

//             try {
//                 const result = await productsCollection.updateOne(
//                     { _id: new ObjectId(id) },
//                     {
//                         $set: {
//                             ...updatedData,
//                             updatedAt: new Date()
//                         }
//                     }
//                 );

//                 res.send({
//                     success: true,
//                     modifiedCount: result.modifiedCount
//                 });
//             } catch (err) {
//                 res.status(500).json({
//                     message: 'Failed to update product',
//                     error: err.message
//                 });
//             }
//         });

//         app.delete('/product/:id', async (req, res) => {
//             const id = req.params.id;

//             try {
//                 const result = await productsCollection.deleteOne({
//                     _id: new ObjectId(id)
//                 });

//                 if (result.deletedCount === 0) {
//                     return res.status(404).json({ message: 'Product not found' });
//                 }

//                 res.send({
//                     success: true,
//                     message: 'Product deleted successfully'
//                 });
//             } catch (err) {
//                 res.status(500).json({
//                     message: 'Failed to delete product',
//                     error: err.message
//                 });
//             }
//         });

//         app.patch('/products/show-home/:id', async (req, res) => {
//             const id = req.params.id;
//             const { showOnHome } = req.body;

//             try {
//                 const result = await productsCollection.updateOne(
//                     { _id: new ObjectId(id) },
//                     { $set: { showOnHome } }
//                 );

//                 res.send({
//                     success: true,
//                     modifiedCount: result.modifiedCount
//                 });
//             } catch (err) {
//                 res.status(500).json({
//                     message: 'Failed to update showOnHome',
//                     error: err.message
//                 });
//             }
//         });

//         // Post Orders
//         app.post('/orders', async (req, res) => {
//             const orderData = req.body;

//             if (!orderData || Object.keys(orderData).length === 0) {
//                 return res.status(400).json({ message: 'Orders data is required' });
//             }

//             try {
//                 const productId = orderData.productId;
//                 if (!productId) {
//                     return res.status(400).json({ message: "Product ID is required" });
//                 }

//                 // ১) Get product from DB
//                 const product = await productsCollection.findOne({ _id: new ObjectId(productId) });
//                 if (!product) {
//                     return res.status(404).json({ message: "Product not found" });
//                 }

//                 // ২) Check stock
//                 if (orderData.quantity > product.quantity) {
//                     return res.status(400).json({ message: "Cannot order more than available stock" });
//                 }

//                 // ৩) Insert order
//                 orderData.createdAt = new Date().toISOString();
//                 const result = await ordersCollection.insertOne(orderData);

//                 // ৪) Update product quantity
//                 const newQuantity = product.quantity - Number(orderData.quantity);
//                 await productsCollection.updateOne(
//                     { _id: new ObjectId(productId) },
//                     { $set: { quantity: newQuantity } }
//                 );

//                 res.status(201).json({
//                     message: "Order placed successfully",
//                     orderId: result.insertedId,
//                     updatedProductQuantity: newQuantity
//                 });

//             } catch (err) {
//                 console.error("Order creation failed:", err);
//                 res.status(500).json({ message: "Failed to create order", error: err.message });
//             }
//         });

//         // GET Orders status, email
//         app.get("/orders", async (req, res) => {
//             try {
//                 const { status, email } = req.query;

//                 const query = {};

//                 // Filter by status
//                 if (status) {
//                     query.status = status;
//                 }

//                 // Filter by user email 
//                 if (email) {
//                     query.email = email;
//                 }

//                 const orders = await ordersCollection
//                     .find(query)
//                     .sort({ createdAt: -1 })
//                     .toArray();

//                 res.status(200).json(orders);

//             } catch (error) {
//                 console.error("Get Orders Error:", error);
//                 res.status(500).json({
//                     message: "Failed to load orders",
//                     error: error.message
//                 });
//             }
//         });

//         app.get('/order/:id', async (req, res) => {
//             try {
//                 const orderId = req.params.id;

//                 if (!orderId) {
//                     return res.status(400).json({ message: "Order ID is required" });
//                 }

//                 const order = await ordersCollection.findOne({ _id: new ObjectId(orderId) });

//                 if (!order) {
//                     return res.status(404).json({ message: "Order not found" });
//                 }

//                 return res.status(200).json(order);

//             } catch (error) {
//                 console.error("Get Order by ID Error:", error);
//                 return res.status(500).json({
//                     message: "Internal Server Error",
//                     error: error.message
//                 });
//             }
//         });

//         // Delete Order by ID
//         app.delete('/order/:id', async (req, res) => {
//             try {
//                 const orderId = req.params.id;

//                 if (!orderId) {
//                     return res.status(400).json({ message: "Order ID is required" });
//                 }

//                 const result = await ordersCollection.deleteOne({ _id: new ObjectId(orderId) });

//                 if (result.deletedCount === 0) {
//                     return res.status(404).json({ message: "Order not found or already deleted" });
//                 }

//                 return res.status(200).json({ message: "Order deleted successfully" });

//             } catch (error) {
//                 console.error("Delete Order Error:", error);
//                 return res.status(500).json({
//                     message: "Internal Server Error",
//                     error: error.message
//                 });
//             }
//         });

//         // UPDATE Order Status
//         app.patch("/orders/:id", async (req, res) => {
//             const { id } = req.params;
//             const { status, tracking, coordinates } = req.body;

//             try {
//                 const updateDoc = { $set: {}, $push: {} };

//                 if (status) {
//                     updateDoc.$set.status = status;
//                     if (status === "Approved") {
//                         updateDoc.$set.approvedAt = new Date();
//                     }
//                 }

//                 if (coordinates) {
//                     updateDoc.$set.coordinates = coordinates;
//                     updateDoc.$set.location = tracking?.location;
//                 }

//                 if (tracking) {
//                     updateDoc.$push.trackingHistory = {
//                         ...tracking,
//                         time: new Date()
//                     };
//                 }

//                 if (Object.keys(updateDoc.$set).length === 0) delete updateDoc.$set;
//                 if (Object.keys(updateDoc.$push).length === 0) delete updateDoc.$push;

//                 const result = await ordersCollection.updateOne(
//                     { _id: new ObjectId(id) },
//                     updateDoc
//                 );

//                 if (result.matchedCount === 0) {
//                     return res.status(404).json({ message: "Order not found" });
//                 }

//                 res.json({ success: true, message: "Order updated successfully" });

//             } catch (error) {
//                 res.status(500).json({ message: "Failed to update order", error: error.message });
//             }
//         });

//         // --- AI CHATBOT ROUTES ---
//         app.post("/chat", async (req, res) => {
//             try {
//                 const { message, history } = req.body;

//                 if (!message || message.trim() === "") {
//                     return res.status(400).json({ error: "Message missing" });
//                 }

//                 const config = await knowledgeCollection.findOne({ type: "instruction" });
//                 const systemPrompt = config?.content || "You are an expert assistant for the Garments Production Tracker System.";

//                 const knowledgeData = await knowledgeCollection
//                     .find({ $text: { $search: message } })
//                     .limit(3)
//                     .toArray();

//                 const hasKnowledge = knowledgeData.length > 0;
//                 const knowledgeText = hasKnowledge
//                     ? knowledgeData.map(k => `Q: ${k.question}\nA: ${k.answer}`).join("\n\n")
//                     : "No specific technical documentation found.";

//                 const model = genAI.getGenerativeModel({
//                     model: "gemini-1.5-flash",
//                     systemInstruction: systemPrompt
//                 });

//                 let cleanHistory = (history || []).filter(
//                     msg => msg.role === "user" || msg.role === "model"
//                 );

//                 const chat = model.startChat({ history: cleanHistory });

//                 const finalMessage = `
//                 ${hasKnowledge ? `Use this context: \n${knowledgeText}` : "Answer based on general knowledge."}
                
//                 User Question: ${message}
                
//                 Provide a clear and concise answer. If you don't know, say you don't know.
//                 `;

//                 const result = await chat.sendMessage(finalMessage);
//                 const reply = result.response.text();

//                 res.json({ reply });

//             } catch (error) {
//                 console.error("AI Error:", error);
//                 res.status(500).json({ error: "AI Error", details: error.message });
//             }
//         });

//         app.post("/admin/ai-config", async (req, res) => {
//             const { content } = req.body;
//             if (!content) return res.status(400).json({ error: "Content required" });

//             await knowledgeCollection.updateOne(
//                 { type: "instruction" },
//                 { $set: { content, updatedAt: new Date() } },
//                 { upsert: true }
//             );
//             res.json({ success: true });
//         });

//         app.post("/admin/add-knowledge", async (req, res) => {
//             const { question, answer } = req.body;
//             const result = await knowledgeCollection.insertOne({ question, answer, type: "qa" });
//             res.json({ success: true, id: result.insertedId });
//         });

//     } catch (err) {
//         console.error('MongoDB connection error:', err);
//     }
// }

// run().catch(console.dir);

// // Start server
// app.listen(port, () => {
//     console.log(`Server running on port ${port}`);
// });

// module.exports = app;
