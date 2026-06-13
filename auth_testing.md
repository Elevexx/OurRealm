# OurRealm Auth Testing Playbook

## Step 1: MongoDB Verification
```
mongosh
use test_database
db.users.find({role: "admin"}).pretty()
db.users.findOne({role: "admin"}, {password_hash: 1})
```
Verify: bcrypt hash starts with `$2b$`, indexes exist on `users.email` (unique), `login_attempts.identifier`, `password_reset_tokens.expires_at` (TTL).

## Step 2: API Testing (use REACT_APP_BACKEND_URL from frontend/.env)
```
API=$(grep REACT_APP_BACKEND_URL /app/frontend/.env | cut -d '=' -f2)
curl -c /tmp/cookies.txt -X POST $API/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@ourrealm.app","password":"admin123"}'
curl -b /tmp/cookies.txt $API/api/auth/me
```

## Auth Endpoints
- POST /api/auth/register  { email, password, name }
- POST /api/auth/login     { email, password }
- POST /api/auth/logout
- GET  /api/auth/me
- POST /api/auth/refresh
- POST /api/auth/forgot-password { email }
- POST /api/auth/reset-password   { token, new_password }

## Test Credentials
- Admin: admin@ourrealm.app / admin123
- Test user: test@ourrealm.app / test1234 (create via /register)
