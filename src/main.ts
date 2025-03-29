import path from 'node:path';
import fs from 'node:fs';
import { execSync } from 'node:child_process';

import { program } from 'commander';
import chalk from 'chalk';
import inquirer from 'inquirer';
import Database from 'better-sqlite3';

import { name, version } from '../package.json';

// ============================================================
// Type Definitions
// ============================================================

// SQLite related types
type SQLiteError = Error & { code?: string };
interface SQLiteTable {
  name: string;
}
interface SQLiteCreateTable {
  sql: string;
}
type SQLiteRow = Record<string, any>;

// SQL parsing related types
interface CommentContext {
  inString: boolean;
  inComment: boolean;
}

interface StringContext {
  inString: boolean;
  stringChar: string;
}

// ============================================================
// SQL Parsing Utility Functions
// ============================================================

/**
 * Handle SQL comments
 * @param char Current character
 * @param nextChar Next character
 * @param context Current context
 * @returns Processing result
 */
function handleComments(
  char: string,
  nextChar: string,
  context: CommentContext
): { shouldContinue: boolean, newInComment: boolean } {
  // Handle comment start
  if (!context.inString && char === '-' && nextChar === '-') {
    return { shouldContinue: true, newInComment: true };
  }

  // Handle comment end (newline)
  if (context.inComment && (char === '\n' || char === '\r')) {
    return { shouldContinue: true, newInComment: false };
  }

  return { shouldContinue: false, newInComment: context.inComment };
}

/**
 * Handle SQL strings
 * @param char Current character
 * @param prevChar Previous character
 * @param context Current context
 * @returns Processing result
 */
function handleStrings(
  char: string,
  prevChar: string,
  context: StringContext
): { shouldContinue: boolean, newInString: boolean, newStringChar: string } {
  // Handle string start
  if (!context.inString && (char === "'" || char === '"')) {
    return { shouldContinue: true, newInString: true, newStringChar: char };
  }

  // Handle string end, note escaped characters
  if (context.inString && char === context.stringChar && prevChar !== '\\') {
    return { shouldContinue: true, newInString: false, newStringChar: '' };
  }

  return { shouldContinue: false, newInString: context.inString, newStringChar: context.stringChar };
}

/**
 * Split SQL statements, correctly handling semicolons in strings and comments
 * @param sqlContent SQL file content
 * @returns Array of split SQL statements
 */
function splitSqlStatements(sqlContent: string): string[] {
  const statements: string[] = [];
  let currentStatement = '';
  let inString = false;
  let inComment = false;
  let stringChar = '';

  for (let i = 0; i < sqlContent.length; i++) {
    const char = sqlContent[i];
    const nextChar = sqlContent[i + 1] || '';
    const prevChar = i > 0 ? sqlContent[i - 1] : '';

    // Add character to current statement
    currentStatement += char;

    // Process comments
    const commentResult = handleComments(char, nextChar, { inString, inComment });
    if (commentResult.shouldContinue) {
      inComment = commentResult.newInComment;
      continue;
    }

    // Skip content inside comments
    if (inComment) {
      continue;
    }

    // Process strings
    const stringResult = handleStrings(char, prevChar, { inString, stringChar });
    if (stringResult.shouldContinue) {
      inString = stringResult.newInString;
      stringChar = stringResult.newStringChar;
      continue;
    }

    // Skip content inside strings
    if (inString) {
      continue;
    }

    // Handle statement delimiter (semicolon)
    if (char === ';') {
      statements.push(currentStatement.trim());
      currentStatement = '';
    }
  }

  // Add the last statement (if any)
  if (currentStatement.trim()) {
    statements.push(currentStatement.trim());
  }

  return statements;
}

// ============================================================
// Core Functionality
// ============================================================

/**
 * Convert SQL file to SQLite database file
 * @param sqlFilePath SQL file path
 * @param sqliteFilePath Target SQLite file path
 */
async function convertSqlToSqlite(sqlFilePath: string, sqliteFilePath: string): Promise<void> {
  if (fs.existsSync(sqliteFilePath)) {
    console.log(chalk.yellow(`SQLite file already exists, overwriting: ${sqliteFilePath}`));
    fs.unlinkSync(sqliteFilePath);
  }

  try {
    // Create new database
    const db = new Database(sqliteFilePath);

    // Read SQL file
    const sqlContent = fs.readFileSync(sqlFilePath, 'utf8');

    // Split SQL statements
    const statements = splitSqlStatements(sqlContent);

    // Begin transaction for better performance
    db.exec('BEGIN TRANSACTION;');

    // Execute each statement
    for (const statement of statements) {
      if (statement.trim()) {
        try {
          db.exec(statement);
        } catch (error) {
          const err = error as SQLiteError;
          console.error(chalk.yellow(`Warning: Failed to execute statement: ${statement.substring(0, 100)}...`));
          console.error(chalk.yellow(`Error: ${err.message}`));
        }
      }
    }

    // Commit transaction
    db.exec('COMMIT;');

    // Optimize database
    db.exec('VACUUM;');

    // Close database connection
    db.close();

    console.log(chalk.green(`Conversion completed! SQLite file saved to: ${sqliteFilePath}`));
    return;
  } catch (error) {
    console.error(chalk.red('Error during SQLite conversion:'), error);
    console.log(chalk.yellow('Falling back to sqlite3 command line...'));

    // Fallback to command line tool if better-sqlite3 fails
    execSync(`sqlite3 "${sqliteFilePath}" "VACUUM;"`, { stdio: 'inherit' });
    execSync(`sqlite3 "${sqliteFilePath}" < "${sqlFilePath}"`, { stdio: 'inherit' });

    console.log(chalk.green(`Conversion completed with fallback method! SQLite file saved to: ${sqliteFilePath}`));
  }
}

/**
 * Convert SQLite database file to SQL file
 * @param sqliteFilePath SQLite file path
 * @param sqlOutputPath Target SQL file path
 */
async function convertSqliteToSql(sqliteFilePath: string, sqlOutputPath: string): Promise<void> {
  try {
    // Try using better-sqlite3
    const db = new Database(sqliteFilePath, { readonly: true });
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all() as SQLiteTable[];

    let sqlOutput = '';

    // Generate CREATE TABLE and INSERT statements for each table
    for (const table of tables) {
      const tableName = table.name;

      // Get table schema
      const createTable = db.prepare(`SELECT sql FROM sqlite_master WHERE type='table' AND name = ?`).get(tableName) as SQLiteCreateTable;
      sqlOutput += `${createTable.sql};\n\n`;

      // Get table data
      const rows = db.prepare(`SELECT * FROM ${tableName}`).all() as SQLiteRow[];

      if (rows.length > 0) {
        // Get column names
        const columns = Object.keys(rows[0]);
        const columnNames = columns.join(', ');

        // Create INSERT statements
        for (const row of rows) {
          const values = columns.map(col => {
            const val = row[col];
            if (val === null) return 'NULL';
            if (typeof val === 'number') return val;
            if (typeof val === 'string') return `'${val.replace(/'/g, "''")}'`;
            if (val instanceof Buffer) return `X'${val.toString('hex')}'`;
            return `'${val}'`;
          }).join(', ');

          sqlOutput += `INSERT INTO ${tableName} (${columnNames}) VALUES (${values});\n`;
        }
        sqlOutput += '\n';
      }
    }

    // Close database connection
    db.close();

    // Write SQL to file
    fs.writeFileSync(sqlOutputPath, sqlOutput);
    return;
  } catch (error) {
    console.error(chalk.yellow('Failed to use better-sqlite3, falling back to command line sqlite3:'), error);

    // Fallback to command line tool if better-sqlite3 fails
    execSync(`sqlite3 "${sqliteFilePath}" .dump > "${sqlOutputPath}"`, { stdio: 'inherit' });
  }
}

// ============================================================
// Command Line Program Setup
// ============================================================

program
  .name(name)
  .version(version)
  .description('A CLI tool to export Cloudflare D1 as SQLite DB File')
  .argument('[database]', 'D1 database name')
  .option('-d, --database <name>', 'D1 database name')
  .option('-t, --table <name>', 'Specific table name to export (optional)')
  .option('-o, --output <path>', 'Output file path for temporary SQL file (will be deleted after conversion)')
  .option('-s, --sqlite <path>', 'SQLite file path (defaults to database name with .sqlite extension)')
  .option('--local', 'Use local database instead of remote', false)
  .option('--no-data', 'Export schema only (no data)', false)
  .option('--no-schema', 'Export data only (no schema)', false)
  .option('--preserve-sql', 'Preserve the intermediate SQL file after conversion', false);

// Import Command - Reserved for future expansion
program
  .command('import')
  .description('Import a SQLite file to a Cloudflare D1 database')
  .option('-d, --database <name>', 'D1 database name')
  .option('-f, --file <path>', 'SQLite or SQL file to import')
  .option('--remote', 'Use remote database', false)
  .action(() => {
    console.log(chalk.yellow('Import functionality will be implemented in a future version.'));
  });

// Convert Command - Convert SQLite to SQL
program
  .command('convert')
  .description('Convert a SQLite database file to SQL for D1 import')
  .option('-f, --file <path>', 'SQLite database file (.sqlite or .sqlite3)')
  .option('-o, --output <path>', 'Output SQL file path')
  .action(async (options) => {
    try {
      // Validate input file
      if (!options.file) {
        const { file } = await inquirer.prompt([
          {
            type: 'input',
            name: 'file',
            message: 'Enter the SQLite database file path:',
            validate: (input) => {
              return fs.existsSync(input) || 'File does not exist';
            }
          }
        ]);
        options.file = file;
      } else if (!fs.existsSync(options.file)) {
        console.error(chalk.red('Error: Input file does not exist'));
        process.exit(1);
      }

      // Use default output path if not specified
      if (!options.output) {
        const inputFile = path.basename(options.file);
        options.output = `./${inputFile.replace(/\.(sqlite|sqlite3|db)$/, '')}.sql`;
      }

      console.log(chalk.blue(`Converting SQLite database to SQL: ${options.file} -> ${options.output}`));

      try {
        await convertSqliteToSql(options.file, options.output);

        console.log(chalk.green('Conversion completed successfully!'));
        console.log(chalk.yellow('Note: You may need to edit the output SQL file to be compatible with D1:'));
        console.log(chalk.yellow('1. Remove `BEGIN TRANSACTION` and `COMMIT;` from the file'));
        console.log(chalk.yellow('2. Remove any _cf_KV table creation statements'));
      } catch (error) {
        console.error(chalk.red('Error during conversion:'), error);
        process.exit(1);
      }
    } catch (error) {
      console.error(chalk.red('Error during conversion:'), error);
      process.exit(1);
    }
  });

// Default action (export)
program.action(async (databaseArg, options) => {
  try {
    // Use database argument if provided, otherwise use --database option
    let databaseName = databaseArg || options.database;

    // Interactive prompt if database name is not provided
    if (!databaseName) {
      const { database } = await inquirer.prompt([
        {
          type: 'input',
          name: 'database',
          message: 'Enter the D1 database name:',
          validate: (input) => input.trim() !== '' || 'Database name is required'
        }
      ]);
      databaseName = database;
    }

    // Use default output path if not specified
    if (!options.output) {
      options.output = `./temp_export_${databaseName}_${Date.now()}.sql`;
    }

    // Use default SQLite path if not specified
    if (!options.sqlite) {
      options.sqlite = `./export_${databaseName}.sqlite`;
    }

    // Prepare wrangler export command
    let exportCommand = `npx wrangler@latest d1 export ${databaseName}`;

    // Use remote database by default, use local only when explicitly specified
    if (!options.local) {
      exportCommand += ' --remote';
    }

    if (options.table) {
      exportCommand += ` --table=${options.table}`;
    }

    exportCommand += ` --output=${options.output}`;

    if (options.noData) {
      exportCommand += ' --no-data';
    }

    if (options.noSchema) {
      exportCommand += ' --no-schema';
    }

    // Execute export command
    console.log(chalk.blue('Exporting D1 database...'));
    console.log(chalk.dim(exportCommand));

    execSync(exportCommand, { stdio: 'inherit' });

    console.log(chalk.green('Export completed successfully!'));

    // Always convert to SQLite
    const sqlFilePath = options.output;
    const sqliteFilePath = options.sqlite;

    console.log(chalk.blue(`Converting SQL export to SQLite file: ${sqliteFilePath}`));

    try {
      await convertSqlToSqlite(sqlFilePath, sqliteFilePath);

      // Delete the intermediate SQL file unless --preserve-sql flag is used
      if (!options.preserveSql) {
        console.log(chalk.dim(`Removing temporary SQL file: ${sqlFilePath}`));
        fs.unlinkSync(sqlFilePath);
        console.log(chalk.green('SQLite export completed! Temporary SQL file has been deleted.'));
      } else {
        console.log(chalk.green('SQLite export completed! SQL file has been preserved as requested.'));
      }
    } catch (error) {
      console.error(chalk.red('Error during conversion:'), error);
      process.exit(1);
    }
  } catch (error) {
    console.error(chalk.red('Error during export:'), error);
    process.exit(1);
  }
});

// Parse command line arguments
program.parse();

// Show help if no arguments provided
if (process.argv.length === 2) {
  program.help();
}
