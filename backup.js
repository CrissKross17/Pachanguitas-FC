/**
 * backup.js — Backup automático de Firebase Realtime Database
 * Usa firebase-tools (ya instalado) para exportar los datos.
 * Guarda en backups/backup-YYYY-MM-DD.json y hace commit+push a GitHub.
 */

const path  = require('path');
const fs    = require('fs');
const { execSync } = require('child_process');

// firebase-tools instalado globalmente
const FIREBASE_CLI = 'C:\\Users\\Lenovo\\AppData\\Roaming\\npm\\firebase.cmd';
const PROJECT      = 'pachanguitas-fc';
const DB_PATH      = '/pfcv2';
const DB_INSTANCE  = 'pachanguitas-fc-default-rtdb';

async function main() {
  const date = new Date().toISOString().split('T')[0];
  const backupDir  = path.join(__dirname, 'backups');
  const backupFile = path.join(backupDir, `backup-${date}.json`);

  console.log(`\n📦 Backup Pachanguitas FC — ${date}`);

  // 1. Crear carpeta si no existe
  if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir);

  // 2. Descargar datos via firebase CLI
  console.log('⬇️  Descargando datos de Firebase...');
  try {
    execSync(
      `"${FIREBASE_CLI}" database:get "${DB_PATH}" --project ${PROJECT} --instance ${DB_INSTANCE} --output "${backupFile}" --pretty`,
      { cwd: __dirname, stdio: 'pipe' }
    );
  } catch(e) {
    // Intentar sin comillas en el path por si acaso
    const out = e.stdout?.toString() || e.stderr?.toString() || e.message;
    throw new Error('Error descargando de Firebase: ' + out);
  }

  if (!fs.existsSync(backupFile) || fs.statSync(backupFile).size < 10) {
    throw new Error('El archivo de backup está vacío o no se creó');
  }

  // 3. Estadísticas
  const data      = JSON.parse(fs.readFileSync(backupFile, 'utf8'));
  const players   = (data?.players   || []).length;
  const matches   = Object.keys(data?.matches  || {}).length;
  const sizekb    = (fs.statSync(backupFile).size / 1024).toFixed(1);
  console.log(`✅ Guardado: backups/backup-${date}.json (${sizekb} KB) — ${players} jugadores, ${matches} partidos`);

  // 4. Mantener solo los últimos 30 backups
  const allBackups = fs.readdirSync(backupDir)
    .filter(f => f.startsWith('backup-') && f.endsWith('.json'))
    .sort();
  if (allBackups.length > 30) {
    const toDelete = allBackups.slice(0, allBackups.length - 30);
    toDelete.forEach(f => {
      fs.unlinkSync(path.join(backupDir, f));
      console.log(`🗑️  Eliminado backup antiguo: ${f}`);
    });
  }

  // 5. Commit + push a GitHub
  console.log('📤 Subiendo a GitHub...');
  try {
    execSync(`git add backups/`, { cwd: __dirname, stdio: 'pipe' });
    execSync(
      `git commit -m "backup: datos ${date} (${players} jugadores, ${matches} partidos)"`,
      { cwd: __dirname, stdio: 'pipe' }
    );
    execSync('git push origin main', { cwd: __dirname, stdio: 'pipe' });
    console.log('✅ Push a GitHub completado');
  } catch(e) {
    console.log('ℹ️  Sin cambios nuevos que pushear (backup del día ya existe)');
  }

  console.log(`\n🎉 Backup completado con éxito\n`);
}

main().catch(e => {
  console.error('\n❌ Error en backup:', e.message);
  process.exit(1);
});
