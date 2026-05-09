import { S3Client, PutBucketCorsCommand } from "@aws-sdk/client-s3";
import { config } from "dotenv";
// Root .env.local da CLOUDFLARE_ prefiksli nomlar bor
config({ path: new URL("../../.env.local", import.meta.url).pathname });

const r2 = new S3Client({
  region: "auto",
  endpoint: `https://${process.env.CLOUDFLARE_R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.CLOUDFLARE_R2_ACCESS_KEY_ID!,
    secretAccessKey: process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY!,
  },
});

async function main() {
  await r2.send(new PutBucketCorsCommand({
  Bucket: process.env.CLOUDFLARE_R2_BUCKET_NAME!,
  CORSConfiguration: {
    CORSRules: [
      {
        AllowedOrigins: ["https://anjir.netlify.app", "http://localhost:3000"],
        AllowedMethods: ["PUT", "GET"],
        AllowedHeaders: ["Content-Type", "Content-Length"],
        MaxAgeSeconds: 3600,
      },
    ],
  },
}));

  console.log("R2 CORS muvaffaqiyatli o'rnatildi");
}

main().catch((e) => { console.error(e); process.exit(1); });
