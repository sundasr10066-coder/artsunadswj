const express = require("express");
const session = require("express-session");
const bcrypt = require("bcryptjs");
const { randomBytes } = require("node:crypto");
const path = require("path");
const rateLimit = require("express-rate-limit");
require("dotenv").config();

const USERNAME_PATTERN = /^[A-Za-z]{4,22}$/;
const GMAIL_PATTERN = /^[A-Za-z0-9._%+-]+@gmail\.com$/i;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PASSWORD_PATTERN = /^(?=.*[A-Z])(?=.*[a-z])(?=.*[0-9])(?=.*[!@#$%^&]).{8,}$/;

const app = express();
const PORT = process.env.PORT || 3000;
const aiChatLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 20,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
        success: false,
        message: "Too many AI requests. Please try again later."
    }
});

let prisma;
let ai;
let googleOAuthClient;

const OAUTH_STATE_MAX_AGE_MS = 10 * 60 * 1000;

class OAuthFlowError extends Error {
    constructor(code) {
        super(code);
        this.name = "OAuthFlowError";
        this.authError = code;
    }
}

function getOAuthIntent(req) {
    return req.query.intent === "signup" ? "signup" : "login";
}

function getAuthPage(intent) {
    return intent === "signup" ? "/signup.html" : "/login.html";
}

function redirectWithAuthError(res, intent, errorCode) {
    return res.redirect(
        `${getAuthPage(intent)}?authError=${encodeURIComponent(errorCode)}`
    );
}

function getOAuthConfig(provider) {
    const config = provider === "google"
        ? {
            clientId: process.env.GOOGLE_CLIENT_ID?.trim(),
            clientSecret: process.env.GOOGLE_CLIENT_SECRET?.trim(),
            callbackUrl: process.env.GOOGLE_CALLBACK_URL?.trim(),
            callbackPath: "/auth/google/callback"
        }
        : {
            clientId: process.env.FACEBOOK_APP_ID?.trim(),
            clientSecret: process.env.FACEBOOK_APP_SECRET?.trim(),
            callbackUrl: process.env.FACEBOOK_CALLBACK_URL?.trim(),
            callbackPath: "/auth/facebook/callback",
            graphVersion: process.env.FACEBOOK_GRAPH_VERSION?.trim() || "v24.0"
        };

    if (!config.clientId || !config.clientSecret || !config.callbackUrl) {
        return null;
    }

    try {
        const callback = new URL(config.callbackUrl);
        const isLocalHttp =
            callback.protocol === "http:" &&
            ["localhost", "127.0.0.1"].includes(callback.hostname);
        if (
            callback.pathname !== config.callbackPath ||
            callback.search ||
            callback.hash ||
            (callback.protocol !== "https:" && !isLocalHttp)
        ) {
            return null;
        }
    } catch {
        return null;
    }

    if (
        provider === "facebook" &&
        !/^v\d+\.\d+$/.test(config.graphVersion)
    ) {
        return null;
    }

    return config;
}

function saveSession(req) {
    return new Promise((resolve, reject) => {
        req.session.save((error) => {
            if (error) {
                reject(error);
                return;
            }
            resolve();
        });
    });
}

function regenerateUserSession(req, user, callback) {
    req.session.regenerate((error) => {
        if (error) {
            callback(error);
            return;
        }

        req.session.userId = user.id;
        req.session.role = user.role;
        req.session.save(callback);
    });
}

function getOAuthAuthorizationUrl(provider, config, state) {
    if (provider === "google") {
        const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
        url.search = new URLSearchParams({
            client_id: config.clientId,
            redirect_uri: config.callbackUrl,
            response_type: "code",
            scope: "openid email profile",
            state,
            prompt: "select_account"
        }).toString();
        return url.toString();
    }

    const url = new URL(
        `https://www.facebook.com/${config.graphVersion}/dialog/oauth`
    );
    url.search = new URLSearchParams({
        client_id: config.clientId,
        redirect_uri: config.callbackUrl,
        response_type: "code",
        scope: "email,public_profile",
        state
    }).toString();
    return url.toString();
}

async function getGoogleIdentity(code, config) {
    const tokenResponse = await fetch(
        "https://oauth2.googleapis.com/token",
        {
            method: "POST",
            headers: {
                "Content-Type": "application/x-www-form-urlencoded"
            },
            body: new URLSearchParams({
                code,
                client_id: config.clientId,
                client_secret: config.clientSecret,
                redirect_uri: config.callbackUrl,
                grant_type: "authorization_code"
            }),
            signal: AbortSignal.timeout(10000)
        }
    );
    const tokens = await tokenResponse.json();
    if (!tokenResponse.ok || typeof tokens.id_token !== "string") {
        throw new OAuthFlowError("social_failed");
    }

    const ticket = await googleOAuthClient.verifyIdToken({
        idToken: tokens.id_token,
        audience: config.clientId
    });
    const payload = ticket.getPayload();
    if (
        !payload ||
        typeof payload.sub !== "string" ||
        typeof payload.email !== "string" ||
        payload.email_verified !== true
    ) {
        throw new OAuthFlowError("social_email_missing");
    }

    return {
        providerAccountId: payload.sub,
        email: payload.email,
        name: typeof payload.name === "string" ? payload.name : ""
    };
}

async function getFacebookIdentity(code, config) {
    const tokenUrl = new URL(
        `https://graph.facebook.com/${config.graphVersion}/oauth/access_token`
    );
    tokenUrl.search = new URLSearchParams({
        client_id: config.clientId,
        client_secret: config.clientSecret,
        redirect_uri: config.callbackUrl,
        code
    }).toString();

    const tokenResponse = await fetch(tokenUrl, {
        signal: AbortSignal.timeout(10000)
    });
    const tokens = await tokenResponse.json();
    if (!tokenResponse.ok || typeof tokens.access_token !== "string") {
        throw new OAuthFlowError("social_failed");
    }

    const profileUrl = new URL(
        `https://graph.facebook.com/${config.graphVersion}/me`
    );
    profileUrl.search = new URLSearchParams({
        fields: "id,name,email"
    }).toString();
    const profileResponse = await fetch(profileUrl, {
        headers: {
            Authorization: `Bearer ${tokens.access_token}`
        },
        signal: AbortSignal.timeout(10000)
    });
    const profile = await profileResponse.json();
    if (
        !profileResponse.ok ||
        typeof profile.id !== "string" ||
        typeof profile.email !== "string"
    ) {
        throw new OAuthFlowError("social_email_missing");
    }

    return {
        providerAccountId: profile.id,
        email: profile.email,
        name: typeof profile.name === "string" ? profile.name : ""
    };
}

async function findOrCreateSocialUser(provider, identity) {
    const email = typeof identity.email === "string"
        ? identity.email.trim().toLowerCase()
        : "";
    if (!EMAIL_PATTERN.test(email) || email.length > 254) {
        throw new OAuthFlowError("social_email_missing");
    }
    if (
        typeof identity.providerAccountId !== "string" ||
        !identity.providerAccountId ||
        identity.providerAccountId.length > 255
    ) {
        throw new OAuthFlowError("social_failed");
    }

    const accountWhere = {
        provider_providerAccountId: {
            provider,
            providerAccountId: identity.providerAccountId
        }
    };
    const existingAccount = await prisma.socialAccount.findUnique({
        where: accountWhere,
        select: {
            user: {
                select: {
                    id: true,
                    role: true
                }
            }
        }
    });
    if (existingAccount) {
        return existingAccount.user;
    }

    const existingUser = await prisma.user.findUnique({
        where: { email },
        select: { id: true }
    });
    if (existingUser) {
        throw new OAuthFlowError("social_email_in_use");
    }

    const name = (
        typeof identity.name === "string" && identity.name.trim()
            ? identity.name.trim()
            : email.split("@")[0]
    ).slice(0, 100);
    const password = randomBytes(32).toString("base64url");
    const passwordHash = await bcrypt.hash(password, 12);

    try {
        const user = await prisma.user.create({
            data: {
                name,
                email,
                password: passwordHash,
                role: "user",
                socialAccounts: {
                    create: {
                        provider,
                        providerAccountId: identity.providerAccountId
                    }
                }
            },
            select: {
                id: true,
                role: true
            }
        });
        return user;
    } catch (error) {
        if (!error || error.code !== "P2002") {
            throw error;
        }

        const accountCreatedByAnotherRequest =
            await prisma.socialAccount.findUnique({
                where: accountWhere,
                select: {
                    user: {
                        select: {
                            id: true,
                            role: true
                        }
                    }
                }
            });
        if (accountCreatedByAnotherRequest) {
            return accountCreatedByAnotherRequest.user;
        }

        throw new OAuthFlowError("social_email_in_use");
    }
}

function generateLocalArtReply(message, artworks) {
    const text = message.toLowerCase();
    const artQuestion =
        /\b(art|painting|artwork|artist|gallery|abstract|classic|classical|modern|creative|contemporary|color|colour|style)\b/.test(text);

    if (!artQuestion) {
        return "I can help with art styles, paintings, artists, and the ArtSphere gallery. What would you like to explore?";
    }

    if (/\b(recommend|suggest|which|first|explore)\b/.test(text)) {
        const styles = ["abstract", "classic", "classical", "modern", "creative", "contemporary"];
        const requestedStyle = styles.find((style) => text.includes(style));
        const artwork = artworks.find((item) =>
            requestedStyle
                ? item.style.toLowerCase().includes(requestedStyle)
                : true
        );

        if (artwork) {
            return `Try "${artwork.title}"${artwork.artist ? ` by ${artwork.artist}` : ""}. ${artwork.description}`;
        }

        return "Explore the ArtSphere gallery and choose a piece whose colors, subject, or style catches your eye.";
    }

    if (/\b(abstract)\b/.test(text)) {
        return "Abstract art uses color, shape, line, and texture to express ideas or feelings, rather than depicting subjects realistically.";
    }

    if (/\b(classic|classical)\b/.test(text)) {
        return "Classical art often emphasizes balance, proportion, and carefully developed technique, drawing on established artistic traditions.";
    }

    if (/\b(modern|contemporary)\b/.test(text)) {
        return "Modern and contemporary art explore new ideas, materials, and ways of seeing. Artists may focus on emotion, everyday life, or experimentation.";
    }

    if (/\b(gallery|collection|artworks?)\b/.test(text)) {
        if (artworks.length) {
            const titles = artworks.slice(0, 5)
                .map((artwork) => `"${artwork.title}" (${artwork.style})`)
                .join(", ");
            return `The ArtSphere collection includes ${titles}. Ask me to recommend one to explore.`;
        }

        return "The ArtSphere gallery is ready for artworks. Check back after the collection has been added.";
    }

    return "Art can communicate ideas and emotions through choices like color, composition, subject, and technique. What style or artwork would you like to discuss?";
}

// =====================================
// START SERVER
// =====================================

async function startServer() {
    try {
        const { PrismaClient } = await import(
            "./generated/prisma/client.ts"
        );

        const { PrismaPg } = await import("@prisma/adapter-pg");

        const adapter = new PrismaPg({
            connectionString: process.env.DATABASE_URL
        });

        prisma = new PrismaClient({ adapter });

        await prisma.$connect();

        console.log("Database connected successfully!");

        const { OAuth2Client } = await import("google-auth-library");
        googleOAuthClient = new OAuth2Client();

        // =====================================
        // AI SETUP (GEMINI)
        // =====================================

        const geminiApiKey = process.env.GEMINI_API_KEY?.trim();

        if (!geminiApiKey) {
            console.info(
                "GEMINI_API_KEY is missing. Using the built-in ArtSphere guide; " +
                "add a key to .env for Gemini responses."
            );
        } else {
            const { GoogleGenAI } = await import("@google/genai");
            ai = new GoogleGenAI({ apiKey: geminiApiKey });
        }

        // =====================================
        // MIDDLEWARE
        // =====================================

        app.use(express.json());

        app.use(express.urlencoded({
            extended: true
        }));

        app.use(
            session({
                secret: process.env.SESSION_SECRET || "artsphere-secret",
                resave: false,
                saveUninitialized: false,
                cookie: {
                    httpOnly: true,
                    maxAge: 1000 * 60 * 60,
                    sameSite: "lax",
                    secure: false
                }
            })
        );

        // =====================================
        // LOGIN MIDDLEWARE
        // =====================================

        function requireLogin(req, res, next) {
            if (!req.session.userId) {
                return res.status(401).json({
                    success: false,
                    message: "Please login first."
                });
            }

            next();
        }

        function requirePageLogin(req, res, next) {
            if (!req.session.userId) {
                return res.redirect(
                    `/login.html?next=${encodeURIComponent(req.originalUrl)}`
                );
            }

            next();
        }

        function startOAuthFlow(provider) {
            return async (req, res) => {
                const intent = getOAuthIntent(req);
                const config = getOAuthConfig(provider);
                if (!config) {
                    console.error(
                        `${provider.toUpperCase()} OAuth configuration is missing or invalid.`
                    );
                    return redirectWithAuthError(res, intent, "not_configured");
                }

                const now = Date.now();
                const states = req.session.oauthStates || {};
                Object.entries(states).forEach(([savedState, stateData]) => {
                    if (
                        !stateData ||
                        !Number.isFinite(stateData.createdAt) ||
                        now - stateData.createdAt > OAUTH_STATE_MAX_AGE_MS
                    ) {
                        delete states[savedState];
                    }
                });
                if (Object.keys(states).length >= 5) {
                    const oldestState = Object.entries(states).sort(
                        (left, right) =>
                            left[1].createdAt - right[1].createdAt
                    )[0];
                    if (oldestState) {
                        delete states[oldestState[0]];
                    }
                }

                const state = randomBytes(32).toString("hex");
                states[state] = {
                    provider,
                    intent,
                    createdAt: now
                };
                req.session.oauthStates = states;

                try {
                    await saveSession(req);
                } catch {
                    console.error("OAUTH SESSION SAVE ERROR.");
                    return redirectWithAuthError(
                        res,
                        intent,
                        "social_session_failed"
                    );
                }

                return res.redirect(
                    getOAuthAuthorizationUrl(provider, config, state)
                );
            };
        }

        function finishOAuthFlow(provider) {
            return async (req, res) => {
                const state = typeof req.query.state === "string"
                    ? req.query.state
                    : "";
                const states = req.session.oauthStates || {};
                const isStateFormatValid = /^[a-f0-9]{64}$/.test(state);
                const stateData = isStateFormatValid
                    ? states[state]
                    : null;

                if (stateData) {
                    delete states[state];
                    req.session.oauthStates = states;
                    try {
                        await saveSession(req);
                    } catch {
                        console.error("OAUTH SESSION SAVE ERROR.");
                        return redirectWithAuthError(
                            res,
                            stateData.intent,
                            "social_session_failed"
                        );
                    }
                }

                const isStateValid =
                    stateData &&
                    stateData.provider === provider &&
                    Number.isFinite(stateData.createdAt) &&
                    Date.now() >= stateData.createdAt &&
                    Date.now() - stateData.createdAt <= OAUTH_STATE_MAX_AGE_MS;
                if (!isStateValid) {
                    return redirectWithAuthError(
                        res,
                        stateData?.intent === "signup" ? "signup" : "login",
                        "social_invalid_state"
                    );
                }

                const intent = stateData.intent;
                if (typeof req.query.error === "string") {
                    return redirectWithAuthError(
                        res,
                        intent,
                        "social_cancelled"
                    );
                }

                const code = typeof req.query.code === "string"
                    ? req.query.code
                    : "";
                if (!code || code.length > 4096) {
                    return redirectWithAuthError(
                        res,
                        intent,
                        "social_failed"
                    );
                }

                const config = getOAuthConfig(provider);
                if (!config) {
                    console.error(
                        `${provider.toUpperCase()} OAuth configuration is missing or invalid.`
                    );
                    return redirectWithAuthError(
                        res,
                        intent,
                        "not_configured"
                    );
                }

                try {
                    const identity = provider === "google"
                        ? await getGoogleIdentity(code, config)
                        : await getFacebookIdentity(code, config);
                    const user = await findOrCreateSocialUser(
                        provider,
                        identity
                    );

                    regenerateUserSession(req, user, (error) => {
                        if (error) {
                            console.error("SOCIAL LOGIN SESSION ERROR.");
                            return redirectWithAuthError(
                                res,
                                intent,
                                "social_session_failed"
                            );
                        }
                        res.redirect("/dashboard.html");
                    });
                } catch (error) {
                    const errorCode = error instanceof OAuthFlowError
                        ? error.authError
                        : "social_failed";
                    if (
                        !(error instanceof OAuthFlowError) ||
                        errorCode === "social_failed"
                    ) {
                        console.error(
                            `${provider.toUpperCase()} OAuth callback failed.`
                        );
                    }
                    return redirectWithAuthError(res, intent, errorCode);
                }
            };
        }

        app.get("/auth/google", startOAuthFlow("google"));
        app.get(
            "/auth/google/callback",
            finishOAuthFlow("google")
        );
        app.get("/auth/facebook", startOAuthFlow("facebook"));
        app.get(
            "/auth/facebook/callback",
            finishOAuthFlow("facebook")
        );

        // =====================================
        // ADMIN MIDDLEWARE
        // =====================================

        async function adminOnly(req, res, next) {
            try {
                if (!req.session.userId) {
                    return res.redirect("/admin-login.html");
                }

                const user = await prisma.user.findUnique({
                    where: {
                        id: Number(req.session.userId)
                    }
                });

                if (!user || user.role !== "admin") {
                    return res.status(403).send(
                        "Access denied. Admin only."
                    );
                }

                req.admin = user;
                next();

            } catch (error) {
                console.error("ADMIN ERROR:", error);

                res.status(500).send(
                    "Admin authentication failed."
                );
            }
        }

        // =====================================
        // HOME PAGE
        // =====================================

        app.get("/", (req, res) => {
            res.sendFile(
                path.join(__dirname, "public", "index.html")
            );
        });

        app.get(
            "/dashboard.html",
            requirePageLogin,
            (req, res) => {
                res.sendFile(
                    path.join(__dirname, "public", "dashboard.html")
                );
            }
        );

        app.get("/ai-assistant.html", (req, res) => {
            res.sendFile(
                path.join(__dirname, "public", "ai-assistant.html")
            );
        });

        // =====================================
        // SIGNUP
        // =====================================

        app.post("/signup", async (req, res) => {
            try {
                const body = req.body || {};
                const name = typeof body.name === "string"
                    ? body.name.trim()
                    : "";
                const username = typeof body.username === "string"
                    ? body.username.toLowerCase()
                    : "";
                const email = typeof body.email === "string"
                    ? body.email.trim().toLowerCase()
                    : "";
                const password = typeof body.password === "string"
                    ? body.password
                    : "";

                if (!name || !username || !email || !password) {
                    return res.status(400).json({
                        success: false,
                        message: "All fields are required."
                    });
                }

                if (name.length < 2 || name.length > 100) {
                    return res.status(400).json({
                        success: false,
                        message: "Full name must be between 2 and 100 characters."
                    });
                }

                if (!USERNAME_PATTERN.test(username)) {
                    return res.status(400).json({
                        success: false,
                        message: "Username must be 4 to 22 letters only (A-Z)."
                    });
                }

                if (!GMAIL_PATTERN.test(email)) {
                    return res.status(400).json({
                        success: false,
                        message: "Please enter valid Gmail with @"
                    });
                }

                if (email.length > 254) {
                    return res.status(400).json({
                        success: false,
                        message: "Email address is too long."
                    });
                }

                if (!PASSWORD_PATTERN.test(password)) {
                    return res.status(400).json({
                        success: false,
                        message:
                            "Password must be at least 8 characters and include " +
                            "an uppercase letter, a lowercase letter, a number, " +
                            "and one special character (! @ # $ % ^ &)."
                    });
                }

                const [existingEmail, existingUsername] = await Promise.all([
                    prisma.user.findUnique({ where: { email } }),
                    prisma.user.findUnique({ where: { username } })
                ]);

                if (existingEmail) {
                    return res.status(409).json({
                        success: false,
                        message: "Email already registered."
                    });
                }

                if (existingUsername) {
                    return res.status(409).json({
                        success: false,
                        message: "Username already taken."
                    });
                }

                const hashedPassword = await bcrypt.hash(
                    password,
                    10
                );

                await prisma.user.create({
                    data: {
                        name,
                        username,
                        email,
                        password: hashedPassword,
                        role: "user"
                    }
                });

                res.status(201).json({
                    success: true,
                    message: "Account created successfully!",
                    redirect: "/login.html"
                });

            } catch (error) {
                if (error && error.code === "P2002") {
                    return res.status(409).json({
                        success: false,
                        message: "Email or username already registered."
                    });
                }

                console.error("SIGNUP ERROR:", error);

                res.status(500).json({
                    success: false,
                    message: "Signup failed."
                });
            }
        });

        function createLoginHandler(adminLoginOnly = false) {
            return async (req, res) => {
                const operation = adminLoginOnly ? "ADMIN LOGIN" : "LOGIN";

                try {
                    const body = req.body || {};
                    const email = typeof body.email === "string"
                        ? body.email.trim().toLowerCase()
                        : "";
                    const password = typeof body.password === "string"
                        ? body.password
                        : "";

                    if (!email || !password) {
                        return res.status(400).json({
                            success: false,
                            message: "Email and password are required."
                        });
                    }

                    if (!EMAIL_PATTERN.test(email)) {
                        return res.status(400).json({
                            success: false,
                            message: "Please enter a valid email address."
                        });
                    }

                    const user = await prisma.user.findUnique({
                        where: { email }
                    });

                    if (
                        !user ||
                        !(await bcrypt.compare(password, user.password))
                    ) {
                        return res.status(401).json({
                            success: false,
                            message: "Invalid email or password."
                        });
                    }

                    if (adminLoginOnly && user.role !== "admin") {
                        return res.status(403).json({
                            success: false,
                            message: "This account does not have admin access."
                        });
                    }

                    req.session.regenerate((error) => {
                        if (error) {
                            console.error("SESSION ERROR:", error);

                            return res.status(500).json({
                                success: false,
                                message: "Login session failed."
                            });
                        }

                        req.session.userId = user.id;
                        req.session.role = user.role;

                        req.session.save((saveError) => {
                            if (saveError) {
                                console.error("SESSION SAVE ERROR:", saveError);

                                return res.status(500).json({
                                    success: false,
                                    message: "Could not save login session."
                                });
                            }

                            res.json({
                                success: true,
                                message: adminLoginOnly
                                    ? "Admin login successful!"
                                    : "Login successful!",
                                redirect: user.role === "admin"
                                    ? "/admin.html"
                                    : "/dashboard.html"
                            });
                        });
                    });
                } catch (error) {
                    console.error(`${operation} ERROR:`, error);

                    res.status(500).json({
                        success: false,
                        message: "Login failed."
                    });
                }
            };
        }

        app.post("/login", createLoginHandler());
        app.post("/admin/login", createLoginHandler(true));

        // =====================================
        // LOGOUT
        // =====================================

        app.get("/logout", (req, res) => {
            req.session.destroy((error) => {
                if (error) {
                    return res.status(500).send(
                        "Logout failed."
                    );
                }

                res.clearCookie("connect.sid");

                res.redirect("/login.html");
            });
        });

        // =====================================
        // CURRENT USER API
        // =====================================

        app.get("/api/me", requireLogin, async (req, res) => {
            try {
                const user = await prisma.user.findUnique({
                    where: {
                        id: Number(req.session.userId)
                    },
                    select: {
                        id: true,
                        name: true,
                        email: true,
                        role: true,
                        createdAt: true
                    }
                });

                if (!user) {
                    return res.status(404).json({
                        success: false,
                        message: "User not found."
                    });
                }

                res.json(user);

            } catch (error) {
                console.error("ME API ERROR:", error);

                res.status(500).json({
                    success: false,
                    message: "Could not load user."
                });
            }
        });

        // =====================================
        // ADMIN DASHBOARD PAGE
        // =====================================

        app.get("/admin.html", adminOnly, (req, res) => {
            res.sendFile(
                path.join(__dirname, "public", "admin.html")
            );
        });

        // =====================================
        // ADMIN USERS LIST
        // =====================================

        app.get(
            "/api/admin/users",
            adminOnly,
            async (req, res) => {
                try {
                    const users = await prisma.user.findMany({
                        select: {
                            id: true,
                            name: true,
                            email: true,
                            role: true,
                            createdAt: true
                        },
                        orderBy: {
                            createdAt: "desc"
                        }
                    });

                    res.json(users);

                } catch (error) {
                    console.error("FETCH USERS ERROR:", error);

                    res.status(500).json({
                        success: false,
                        message: "Unable to fetch users."
                    });
                }
            }
        );

        // =====================================
        // LIST ARTWORKS (public — any logged-in user)
        // =====================================

        app.get(
            "/api/artworks",
            requireLogin,
            async (req, res) => {
                try {
                    const artworks = await prisma.artwork.findMany({
                        orderBy: {
                            createdAt: "asc"
                        }
                    });

                    res.json(artworks);

                } catch (error) {
                    console.error("FETCH ARTWORKS ERROR:", error);

                    res.status(500).json({
                        success: false,
                        message: "Unable to fetch artworks."
                    });
                }
            }
        );

        // =====================================
        // AI ART ASSISTANT CHAT
        // =====================================

        app.post(
            "/api/ai/chat",
            aiChatLimiter,
            async (req, res) => {
                try {
                    const { message } = req.body;

                    if (
                        !message ||
                        typeof message !== "string" ||
                        message.trim().length === 0
                    ) {
                        return res.status(400).json({
                            success: false,
                            message: "Please provide a message."
                        });
                    }

                    if (message.length > 1000) {
                        return res.status(400).json({
                            success: false,
                            message: "Message is too long (max 1000 characters)."
                        });
                    }

                    if (!ai) {
                        const artworks = await prisma.artwork.findMany({
                            select: {
                                title: true,
                                description: true,
                                style: true,
                                artist: true
                            },
                            orderBy: {
                                createdAt: "asc"
                            }
                        });

                        return res.json({
                            success: true,
                            reply: generateLocalArtReply(message, artworks),
                            mode: "local"
                        });
                    }

                    const systemInstruction =
                        "You are the ArtSphere AI Art Assistant. " +
                        "You help users explore the ArtSphere gallery. " +
                        "You can answer questions about art styles " +
                        "(Classic, Abstract, Modern, Creative), explain what " +
                        "makes a painting unique, and suggest which artwork a " +
                        "user might like. Keep answers friendly, concise, and " +
                        "related to art and the ArtSphere website. Do not " +
                        "answer questions unrelated to art or this gallery.";

                    const response = await ai.interactions.create({
                        model: "gemini-3.5-flash-lite",
                        input: message,
                        system_instruction: systemInstruction,
                        store: false
                    }, {
                        timeout_ms: 30000,
                        retries: 0
                    });

                    const reply = response.output_text?.trim();

                    if (!reply) {
                        throw new Error("Gemini returned an empty response.");
                    }

                    res.json({
                        success: true,
                        reply: reply,
                        mode: "gemini"
                    });

                } catch (error) {
                    console.error("AI CHAT ERROR:", error);

                    res.status(500).json({
                        success: false,
                        message:
                            "The AI assistant is unavailable right now. " +
                            "Please try again later."
                    });
                }
            }
        );

        // =====================================
        // CHANGE USER ROLE
        // =====================================

        app.patch(
            "/api/admin/users/:id/role",
            adminOnly,
            async (req, res) => {
                try {
                    const userId = Number(req.params.id);
                    const newRole = req.body.role;

                    if (
                        !Number.isInteger(userId) ||
                        userId <= 0
                    ) {
                        return res.status(400).json({
                            success: false,
                            message: "Invalid user ID."
                        });
                    }

                    if (
                        newRole !== "user" &&
                        newRole !== "admin"
                    ) {
                        return res.status(400).json({
                            success: false,
                            message: "Role must be 'user' or 'admin'."
                        });
                    }

                    if (userId === Number(req.admin.id)) {
                        return res.status(403).json({
                            success: false,
                            message: "You cannot change your own role."
                        });
                    }

                    const user = await prisma.user.findUnique({
                        where: { id: userId }
                    });

                    if (!user) {
                        return res.status(404).json({
                            success: false,
                            message: "User not found."
                        });
                    }

                    await prisma.user.update({
                        where: { id: userId },
                        data: { role: newRole }
                    });

                    console.log(
                        "ROLE CHANGED:",
                        user.email,
                        "→",
                        newRole
                    );

                    res.json({
                        success: true,
                        message: "User role updated successfully."
                    });

                } catch (error) {
                    console.error("CHANGE ROLE ERROR:", error);

                    res.status(500).json({
                        success: false,
                        message: "Unable to change role."
                    });
                }
            }
        );

        // =====================================
        // DELETE USER
        // =====================================

        app.delete(
            "/api/admin/users/:id",
            adminOnly,
            async (req, res) => {
                try {
                    const userId = Number(req.params.id);

                    if (
                        !Number.isInteger(userId) ||
                        userId <= 0
                    ) {
                        return res.status(400).json({
                            success: false,
                            message: "Invalid user ID."
                        });
                    }

                    if (
                        userId === Number(req.admin.id)
                    ) {
                        return res.status(403).json({
                            success: false,
                            message: "You cannot delete your own admin account."
                        });
                    }

                    const user = await prisma.user.findUnique({
                        where: { id: userId }
                    });

                    if (!user) {
                        return res.status(404).json({
                            success: false,
                            message: "User not found."
                        });
                    }

                    await prisma.user.delete({
                        where: { id: userId }
                    });

                    console.log(
                        "USER DELETED:",
                        user.email
                    );

                    res.json({
                        success: true,
                        message: "User deleted successfully."
                    });

                } catch (error) {
                    console.error("DELETE USER ERROR:", error);

                    res.status(500).json({
                        success: false,
                        message: "Unable to delete user."
                    });
                }
            }
        );

        // =====================================
        // STATIC FILES
        // =====================================

        app.use(express.static(
            path.join(__dirname, "public")
        ));

        // =====================================
        // SERVER START
        // =====================================

        app.listen(PORT, () => {
            console.log(
                `ArtSphere running at http://localhost:${PORT}`
            );
        });

    } catch (error) {
        console.error("SERVER START ERROR:", error);
        process.exit(1);
    }
}

startServer();