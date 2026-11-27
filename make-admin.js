
const dotenv = require("dotenv");
dotenv.config();

async function makeAdmin() {
    const email = process.argv[2]?.trim().toLowerCase();

    if (!email) {
        throw new Error(
            "Usage: npm run make-admin -- <account-email>"
        );
    }

    let prisma;

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

        const existingUser = await prisma.user.findUnique({
            where: { email }
        });

        if (!existingUser) {
            throw new Error(
                `No account found for ${email}. Create the account before making it an admin.`
            );
        }

        if (existingUser.role !== "admin") {
            await prisma.user.update({
                where: { email },
                data: { role: "admin" }
            });
        }

        console.log(`SUCCESS! ${email} has admin access.`);

    } finally {
        if (prisma) {
            await prisma.$disconnect();
        }
    }
}

makeAdmin().catch((error) => {
    console.error("Admin update failed:", error.message);
    process.exitCode = 1;
});
