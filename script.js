
const express = require("express");
const session = require("express-session");
const bcrypt = require("bcryptjs");
const dotenv = require("dotenv");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const path = require("path");

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(helmet({
    contentSecurityPolicy: false
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
        httpOnly: true,
        secure: false,
        sameSite: "lax",
        maxAge: 1000 * 60 * 60
    }
}));

const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 10,
    message: "Too many attempts. Please try again later."
});

// Prisma 7 connection
let prisma;

async function startServer() {
    try {
        const { PrismaClient } =
            await import("./generated/prisma/client.ts");

        const { PrismaPg } =
            await import("@prisma/adapter-pg");

        const adapter = new PrismaPg({
            connectionString: process.env.DATABASE_URL
        });

        prisma = new PrismaClient({ adapter });

        await prisma.$connect();

        console.log("PostgreSQL connected successfully!");

        // Signup
        app.post("/signup", async (req, res) => {
            try {
                const name = req.body.name?.trim();
                const email = req.body.email?.trim().toLowerCase();
                const password = req.body.password;

                if (!name || !email || !password) {
                    return res.status(400).send("Please fill all fields.");
                }

                if (password.length < 8) {
                    return res.status(400).send(
                        "Password must be at least 8 characters."
                    );
                }

                const existingUser = await prisma.user.findUnique({
                    where: { email }
                });

                if (existingUser) {
                    return res.status(409).send(
                        "Email already registered. Please login."
                    );
                }

                const hashedPassword = await bcrypt.hash(password, 12);

                const user = await prisma.user.create({
                    data: {
                        name,
                        email,
                        password: hashedPassword
                    }
                });

                req.session.userId = user.id;
                req.session.userName = user.name;

                req.session.save((err) => {
                    if (err) {
                        return res.status(500).send("Session error.");
                    }

                    res.redirect("/dashboard.html");
                });

            } catch (error) {
                console.error("Signup error:", error);
                res.status(500).send("Signup failed. Please try again.");
            }
        });

        // Login
        app.post("/login", loginLimiter, async (req, res) => {
            try {
                const email = req.body.email?.trim().toLowerCase();
                const password = req.body.password;

                if (!email || !password) {
                    return res.status(400).send(
                        "Please enter email and password."
                    );
                }

                const user = await prisma.user.findUnique({
                    where: { email }
                });

                if (!user) {
                    return res.status(401).send(
                        "Invalid email or password."
                    );
                }

                const passwordMatch = await bcrypt.compare(
                    password,
                    user.password
                );

                if (!passwordMatch) {
                    return res.status(401).send(
                        "Invalid email or password."
                    );
                }

                req.session.regenerate((err) => {
                    if (err) {
                        return res.status(500).send("Login session error.");
                    }

                    req.session.userId = user.id;
                    req.session.userName = user.name;

                    req.session.save((saveError) => {
                        if (saveError) {
                            return res.status(500).send("Session error.");
                        }

                        res.redirect("/dashboard.html");
                    });
                });

            } catch (error) {
                console.error("Login error:", error);
                res.status(500).send("Login failed. Please try again.");
            }
        });

        // Protect dashboard
        app.get("/dashboard.html", (req, res) => {
            if (!req.session.userId) {
                return res.redirect("/login.html");
            }

            res.sendFile(path.join(__dirname, "public", "dashboard.html"));
        });

        // Current logged-in user
        app.get("/api/me", (req, res) => {
            if (!req.session.userId) {
                return res.status(401).json({
                    loggedIn: false
                });
            }

            res.json({
                loggedIn: true,
                name: req.session.userName
            });
        });

        // Logout
        app.get("/logout", (req, res) => {
            req.session.destroy(() => {
                res.clearCookie("connect.sid");
                res.redirect("/login.html");
            });
        });

        // Serve frontend files
        app.use(express.static(path.join(__dirname, "public"), {
            index: "index.html"
        }));

        app.listen(PORT, () => {
            console.log(`ArtSphere running at http://localhost:${PORT}`);
        });

    } catch (error) {
        console.error("Server startup error:", error);
        process.exit(1);
    }
}

startServer();
