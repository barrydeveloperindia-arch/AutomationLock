# Dockerfile for Smart Door Biometric Engine
FROM python:3.10-slim

# Install system dependencies
RUN apt-get update && apt-get install -y \
    build-essential \
    cmake \
    libopenblas-dev \
    liblapack-dev \
    libx11-dev \
    libgtk-3-dev \
    python3-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Optimized installation for memory-constrained environments
COPY edge/requirements.txt .

# 1. Install dlib first with limited parallelism to prevent OOM (8GB limit)
# 2. Install opencv-python-headless to avoid heavy GUI dependencies
# 3. Install remaining requirements
RUN MAKEFLAGS="-j1" pip install --no-cache-dir dlib==19.24.1 && \
    pip install --no-cache-dir opencv-python-headless && \
    pip install --no-cache-dir -r requirements.txt

# Copy application code
COPY edge/ .

# Expose port
EXPOSE 8001

# Start application using uvicorn
CMD ["uvicorn", "biometric_api:app", "--host", "0.0.0.0", "--port", "8001"]
