#!/usr/bin/env node
/**
 * Uploads exercise media to Cloudflare R2 bucket using S3-compatible API.
 * Run: node scripts/upload-media-to-r2.mjs
 * 
 * Requires R2 API token with read/write permissions.
 * Set: R2_ACCESS_KEY_ID and R2_SECRET_ACCESS_KEY env vars
 */

// Bypass corporate SSL proxy certificate issues
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'

import { S3Client, PutObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3'
import https from 'node:https'
import fs from 'node:fs'
import path from 'node:path'

const ACCOUNT_ID = '987ae10a695c542653fd42b42216779c'
const BUCKET = 'fitness-media'
const MEDIA_DIR = path.join(import.meta.dirname, '../catalogue/media')
const R2_ENDPOINT = `https://${ACCOUNT_ID}.r2.cloudflarestorage.com`

// Cache-Control: images never change, cache for 1 year
const CACHE_CONTROL = 'public, max-age=31536000, immutable'

const CONTENT_TYPES = {
  '.webp': 'image/webp',
  '.mp4': 'video/mp4',
  '.gif': 'image/gif',
  '.jpg': 'image/jpeg',
  '.png': 'image/png',
  '.md': 'text/markdown'
}

if (!process.env.R2_ACCESS_KEY_ID || !process.env.R2_SECRET_ACCESS_KEY) {
  console.error(`
Missing R2 credentials. Create an R2 API token in Cloudflare dashboard:
1. Go to R2 > Overview > Manage R2 API Tokens
2. Create token with "Object Read & Write" permission for fitness-media bucket
3. Run with:
   R2_ACCESS_KEY_ID=xxx R2_SECRET_ACCESS_KEY=xxx node scripts/upload-media-to-r2.mjs
`)
  process.exit(1)
}

const client = new S3Client({
  region: 'auto',
  endpoint: R2_ENDPOINT,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
  // Bypass SSL certificate verification for corporate proxies
  requestHandler: {
    httpsAgent: new https.Agent({ rejectUnauthorized: false })
  }
})

async function objectExists(key) {
  try {
    await client.send(new HeadObjectCommand({ Bucket: BUCKET, Key: key }))
    return true
  } catch {
    return false
  }
}

async function uploadFile(localPath, remotePath, skipExisting = true) {
  if (skipExisting && await objectExists(remotePath)) {
    return 'skipped'
  }
  
  const ext = path.extname(localPath).toLowerCase()
  const contentType = CONTENT_TYPES[ext] || 'application/octet-stream'
  const body = fs.readFileSync(localPath)
  
  await client.send(new PutObjectCommand({
    Bucket: BUCKET,
    Key: remotePath,
    Body: body,
    ContentType: contentType,
    CacheControl: CACHE_CONTROL,
  }))
  
  return 'uploaded'
}

function getFiles(dir, prefix = '') {
  const files = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const localPath = path.join(dir, entry.name)
    const remotePath = prefix ? `${prefix}/${entry.name}` : entry.name
    if (entry.isDirectory()) {
      files.push(...getFiles(localPath, remotePath))
    } else {
      files.push({ localPath, remotePath })
    }
  }
  return files
}

async function main() {
  console.log('Uploading exercise media to R2...')
  console.log(`Source: ${MEDIA_DIR}`)
  console.log(`Bucket: ${BUCKET}`)
  console.log(`Endpoint: ${R2_ENDPOINT}`)
  console.log('')

  const files = getFiles(MEDIA_DIR)
  console.log(`Found ${files.length} files to upload`)
  
  let uploaded = 0, skipped = 0, failed = 0
  const BATCH_SIZE = 20 // Concurrent uploads
  
  for (let i = 0; i < files.length; i += BATCH_SIZE) {
    const batch = files.slice(i, i + BATCH_SIZE)
    const results = await Promise.allSettled(
      batch.map(f => uploadFile(f.localPath, f.remotePath))
    )
    
    for (const r of results) {
      if (r.status === 'fulfilled') {
        if (r.value === 'uploaded') uploaded++
        else skipped++
      } else {
        failed++
        console.error(`\nFailed: ${r.reason?.message || r.reason}`)
      }
    }
    
    const progress = Math.min(i + BATCH_SIZE, files.length)
    process.stdout.write(`\rProgress: ${progress}/${files.length} (${uploaded} new, ${skipped} exist, ${failed} failed)`)
  }

  console.log('\n\nDone!')
  console.log(`Uploaded: ${uploaded}, Skipped: ${skipped}, Failed: ${failed}`)
  console.log(`\nMedia URL: https://pub-f9109f6f872c420a8a2113da82a42985.r2.dev/`)
}

main().catch(e => { console.error(e); process.exit(1) })
