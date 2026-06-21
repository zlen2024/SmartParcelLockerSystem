# ──────────────────────────────────────────────────────────────
#  Pick N Go – Smart Parcel Locker System
#  Multi-runtime Dockerfile (Python + Node.js)
# ──────────────────────────────────────────────────────────────

FROM python:3.11-slim

# ── 1. Install Node.js (needed for mailer.js / Nodemailer) ───
RUN apt-get update && \
    apt-get install -y --no-install-recommends curl ca-certificates && \
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash - && \
    apt-get install -y --no-install-recommends nodejs && \
    apt-get clean && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# ── 2. Install Python dependencies ──────────────────────────
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# ── 3. Install Node.js dependencies (nodemailer + dotenv) ───
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev 2>/dev/null || npm install --omit=dev

# ── 4. Copy application source ──────────────────────────────
COPY . .

# ── 5. Create a directory for the SQLite DB (persistent vol) ─
RUN mkdir -p /data

# ── 6. Expose the port Fly.io expects ───────────────────────
EXPOSE 8080

# ── 7. Start with gunicorn + uvicorn workers ─────────────────
#    Fly.io health checks hit the internal port 8080.
#    DATABASE_URL defaults to a file on the persistent volume.
ENV DATABASE_URL="sqlite:////data/pickngo_v2.db"
ENV PORT=8080

CMD ["gunicorn", "main:app", \
     "--worker-class", "uvicorn.workers.UvicornWorker", \
     "--bind", "0.0.0.0:8080", \
     "--workers", "1", \
     "--timeout", "120"]
