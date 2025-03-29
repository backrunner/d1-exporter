# D1 Exporter

A CLI tool to export Cloudflare D1 databases as SQLite files.

This tool helps you export your Cloudflare D1 databases or specific tables directly to SQLite files. It uses the Cloudflare Wrangler CLI under the hood and provides a convenient interface with additional features.

## Features

- Export entire D1 databases or specific tables
- Export schema only, data only, or both
- Directly convert D1 exports to SQLite database files
- Convert existing SQLite files to SQL format for D1 import
- Interactive prompts when required arguments are missing
- Automatically cleans up temporary files

## Prerequisites

- Node.js 16.x or later
- Wrangler CLI (installed automatically as a dependency)
- SQLite CLI (required for convert operations)

## Installation

### Global Installation

```bash
npm install -g d1-exporter
```

### Local Installation

```bash
npm install d1-exporter
```

## Usage

### Export a D1 Database

```bash
# Export entire database (schema + data) to SQLite (simple)
d1-export my-database

# Export entire database (schema + data) to SQLite (with named option)
d1-export --database my-database

# Export a specific table to SQLite
d1-export my-database --table users

# Export with custom SQLite output path
d1-export my-database --sqlite ./my-db.sqlite

# Export schema only (no data)
d1-export my-database --no-data

# Export data only (no schema)
d1-export my-database --no-schema

# Export and preserve the intermediate SQL file
d1-export my-database --preserve-sql

# Export from local database instead of remote
d1-export my-database --local
```

### Convert a SQLite File to SQL

```bash
d1-export convert --file ./database.sqlite --output ./database.sql
```

### Command Options

#### Export Command (Default)

| Option                  | Description                                                           |
| ----------------------- | --------------------------------------------------------------------- |
| `-d, --database <name>` | D1 database name                                                      |
| `-t, --table <name>`    | Specific table name to export (optional)                              |
| `-o, --output <path>`   | Output path for temporary SQL file (will be deleted after conversion) |
| `-s, --sqlite <path>`   | SQLite file path (defaults to ./export\_<db_name>.sqlite)             |
| `--local`               | Use local database instead of remote (defaults to false)              |
| `--no-data`             | Export schema only (no data)                                          |
| `--no-schema`           | Export data only (no schema)                                          |
| `--preserve-sql`        | Preserve the intermediate SQL file after conversion                   |

#### Convert Command

| Option                | Description                                |
| --------------------- | ------------------------------------------ |
| `-f, --file <path>`   | SQLite database file (.sqlite or .sqlite3) |
| `-o, --output <path>` | Output SQL file path                       |

## Known Limitations

As documented by Cloudflare:

- Export is not supported for virtual tables, including databases with virtual tables.
- A running export will block other database requests.
- For imports, D1 execute --file is limited to 5GiB files.

## License

MIT
