// seed-artworks.js
// One-time script: inserts featured paintings into the Artwork table.
// Safe to run multiple times — it skips any title that already exists.

require("dotenv").config();

async function main() {
    const { PrismaClient } = await import(
        "./generated/prisma/client.ts"
    );
    const { PrismaPg } = await import("@prisma/adapter-pg");

    const adapter = new PrismaPg({
        connectionString: process.env.DATABASE_URL
    });

    const prisma = new PrismaClient({ adapter });

    await prisma.$connect();

    const artworks = [
        {
            title: "Classic Painting",
            description: "A timeless work rooted in traditional painting.",
            imageUrl:
                "https://images.unsplash.com/photo-1579783902614-a3fb3927b6a5?w=500",
            style: "Classic",
            artist: "Unknown Artist"
        },
        {
            title: "Timeless Portrait",
            description: "A portrait inspired by classical art traditions.",
            imageUrl:
                "https://images.unsplash.com/photo-1579783901586-d88db74b4fe4?w=500",
            style: "Classic",
            artist: "Unknown Artist"
        },
        {
            title: "Heritage in Color",
            description: "Rich colors and details in a traditional style.",
            imageUrl:
                "https://images.unsplash.com/photo-1579783900882-c0d3dad7b119?w=500",
            style: "Classic",
            artist: "Unknown Artist"
        },
        {
            title: "The Old Masters",
            description: "An appreciation of enduring painting techniques.",
            imageUrl:
                "https://images.unsplash.com/photo-1561214115-f2f134cc4912?w=500",
            style: "Classic",
            artist: "Unknown Artist"
        },
        {
            title: "Gallery Study",
            description: "A traditional composition made for close viewing.",
            imageUrl:
                "https://images.unsplash.com/photo-1547891654-e66ed7ebb968?w=500",
            style: "Classic",
            artist: "Unknown Artist"
        },
        {
            title: "Abstract Art",
            description: "Color and form come together in an expressive composition.",
            imageUrl:
                "https://images.unsplash.com/photo-1577083552431-6e5fd01aa342?w=500",
            style: "Abstract",
            artist: "Unknown Artist"
        },
        {
            title: "Color Field",
            description: "An exploration of color, balance, and space.",
            imageUrl:
                "https://images.unsplash.com/photo-1549490349-8643362247b5?w=500",
            style: "Abstract",
            artist: "Unknown Artist"
        },
        {
            title: "Shape in Motion",
            description: "Bold shapes create a sense of movement.",
            imageUrl:
                "https://images.unsplash.com/photo-1547891654-e66ed7ebb968?w=500",
            style: "Abstract",
            artist: "Unknown Artist"
        },
        {
            title: "Chromatic Layers",
            description: "Layers of color create a lively abstract work.",
            imageUrl:
                "https://images.unsplash.com/photo-1578301978018-3005759f48f7?w=500",
            style: "Abstract",
            artist: "Unknown Artist"
        },
        {
            title: "Beyond the Canvas",
            description: "An imaginative composition without boundaries.",
            imageUrl:
                "https://images.unsplash.com/photo-1578301978693-85fa9c0320b9?w=500",
            style: "Abstract",
            artist: "Unknown Artist"
        },
        {
            title: "Modern Art",
            description: "Modern artistic expressions.",
            imageUrl:
                "https://images.unsplash.com/photo-1541961017774-22349e4a1262?w=500",
            style: "Modern",
            artist: "Unknown Artist"
        },
        {
            title: "Urban Geometry",
            description: "A contemporary study of architectural forms.",
            imageUrl:
                "https://images.unsplash.com/photo-1486718448742-163732cd1544?w=500",
            style: "Modern",
            artist: "Unknown Artist"
        },
        {
            title: "New Perspective",
            description: "A fresh look at shape and composition.",
            imageUrl:
                "https://images.unsplash.com/photo-1543857778-c4a1a3e0b2eb?w=500",
            style: "Modern",
            artist: "Unknown Artist"
        },
        {
            title: "Minimal Form",
            description: "A contemporary composition with a clean visual focus.",
            imageUrl:
                "https://images.unsplash.com/photo-1579546929518-9e396f3cc809?w=500",
            style: "Modern",
            artist: "Unknown Artist"
        },
        {
            title: "Modern Gallery",
            description: "A modern work with a confident use of color.",
            imageUrl:
                "https://images.unsplash.com/photo-1513519245088-0e12902e5a38?w=500",
            style: "Modern",
            artist: "Unknown Artist"
        },
        {
            title: "Creative Art",
            description: "Explore beautiful creativity.",
            imageUrl:
                "https://images.unsplash.com/photo-1578301978693-85fa9c0320b9?w=500",
            style: "Creative",
            artist: "Unknown Artist"
        },
        {
            title: "Dreamscape",
            description: "An imaginative world built from color and texture.",
            imageUrl:
                "https://images.unsplash.com/photo-1501472312651-726afe119ff1?w=500",
            style: "Creative",
            artist: "Unknown Artist"
        },
        {
            title: "Wild Ideas",
            description: "A playful composition that follows curiosity.",
            imageUrl:
                "https://images.unsplash.com/photo-1513364776144-60967b0f800f?w=500",
            style: "Creative",
            artist: "Unknown Artist"
        },
        {
            title: "The Unexpected",
            description: "Unexpected colors make a distinctive statement.",
            imageUrl:
                "https://images.unsplash.com/photo-1549490349-8643362247b5?w=500",
            style: "Creative",
            artist: "Unknown Artist"
        },
        {
            title: "Color Play",
            description: "A joyful mix of color and creative expression.",
            imageUrl:
                "https://images.unsplash.com/photo-1582201942988-13e60e4556ee?w=500",
            style: "Creative",
            artist: "Unknown Artist"
        }
    ];

    let inserted = 0;
    let skipped = 0;

    for (const artwork of artworks) {
        const existing = await prisma.artwork.findFirst({
            where: { title: artwork.title }
        });

        if (existing) {
            skipped++;
            continue;
        }

        await prisma.artwork.create({ data: artwork });
        inserted++;
    }

    console.log(
        `Seed complete. Inserted: ${inserted}, Skipped (already existed): ${skipped}`
    );

    await prisma.$disconnect();
}

main().catch((error) => {
    console.error("SEED ERROR:", error);
    process.exit(1);
});