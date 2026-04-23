FROM python:3.12-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    libpq-dev gcc libgl1 libglib2.0-0 wget \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

EXPOSE 3001

CMD ["uvicorn", "main:socket_app", "--host", "0.0.0.0", "--port", "3001"]
