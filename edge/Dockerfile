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
COPY requirements.txt .
COPY dlib-19.24.1-cp310-cp310-linux_x86_64.whl .

# Install statically compiled Dlib wheel, bypassing all C++ build steps completely
RUN pip install --no-cache-dir dlib-19.24.1-cp310-cp310-linux_x86_64.whl && \
    pip install --no-cache-dir "opencv-python-headless<4.10.0" && \
    pip install --no-cache-dir -r requirements.txt

# Pre-download face-recognition models to prevent runtime timeouts
RUN python3 -c "import face_recognition; face_recognition.face_encodings(face_recognition.load_image_file('/app/requirements.txt'))" || true

# Copy application code
COPY . .

# Start application. Cloud Run provides PORT env var, we fallback to 8080
CMD uvicorn biometric_api:app --host 0.0.0.0 --port ${PORT:-8080}
