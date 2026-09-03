# Whereहो (whereho)

Prototype web app: safety-aware routing and SOS features using Google Maps, MSG91 for SMS, and Gmail (SMTP) for email verification.

This repo contains a minimal scaffold to get started locally.

ENV vars (create a .env file in backend/):

- APP_URL=http://localhost:4000
- PORT=4000
- JWT_SECRET=your_jwt_secret
- MSG91_AUTH_KEY=your_msg91_api_key
- MSG91_SENDER=MSGIND
- GMAIL_USER=your@gmail.com
- GMAIL_PASS=your_gmail_app_password
- GOOGLE_MAPS_API_KEY=your_google_maps_key

Run the backend:

cd backend
npm install
npm run dev

Run the frontend:

cd frontend
npm install
npm start

