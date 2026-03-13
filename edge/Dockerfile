# Dockerfile for Smart Door Biometric Engine
FROM python:3.10-slim

# Install system dependencies for facial recognition (cmake, g++, etc.)
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

# Copy requirements and install
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Pre-download models to make startup faster if possible
# (DeepFace will download on first run, which can be slow. 
# For production, we'd ideally bake them into the image or a volume)

# Copy application code
COPY . .

# Expose port
EXPOSE 8001

# Start application using uvicorn
CMD ["uvicorn", "biometric_api:app", "--host", "0.0.0.0", "--port", "8001"]
