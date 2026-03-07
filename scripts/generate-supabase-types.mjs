import { spawn } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

const projectId = process.env.SUPABASE_PROJECT_ID
const accessToken = process.env.SUPABASE_ACCESS_TOKEN
const dbUrl = process.env.SUPABASE_DB_URL

const outputFile = resolve(process.cwd(), 'src/types/database.generated.ts')
const args = ['--yes', 'supabase@latest', 'gen', 'types', 'typescript', '--schema', 'public']

if (projectId) {
    if (!accessToken) {
        console.error('SUPABASE_PROJECT_ID kullanırken SUPABASE_ACCESS_TOKEN da gerekli.')
        process.exit(1)
    }
    args.push('--project-id', projectId)
} else if (dbUrl) {
    args.push('--db-url', dbUrl)
} else {
    console.error('SUPABASE_PROJECT_ID (+ SUPABASE_ACCESS_TOKEN) veya SUPABASE_DB_URL tanımlanmalı.')
    process.exit(1)
}

const child = spawn('npx', args, {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: process.env,
    shell: process.platform === 'win32',
})

let stdout = ''
let stderr = ''

child.stdout.on('data', (chunk) => {
    stdout += chunk.toString()
})

child.stderr.on('data', (chunk) => {
    stderr += chunk.toString()
})

child.on('close', (code) => {
    if (code !== 0 || !stdout.trim()) {
        console.error(stderr || 'Supabase type üretimi başarısız oldu.')
        process.exit(code ?? 1)
    }

    const banner = `// This file is auto-generated from Supabase schema.\n// Regenerate with: npm run db:types\n\n`
    mkdirSync(dirname(outputFile), { recursive: true })
    writeFileSync(outputFile, `${banner}${stdout.trim()}\n`, 'utf8')
    console.log(`Supabase type dosyası güncellendi: ${outputFile}`)
})
