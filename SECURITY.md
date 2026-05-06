# 🔒 Security Guide - Hospital DMS

## Critical Security Considerations

### 1. **Admin Credentials Protection**

⚠️ **NEVER commit real credentials to Git!**

The admin credentials are now stored in environment variables for security:

```bash
ADMIN_EMPLOYEE_ID=your_secure_admin_id
ADMIN_PASSWORD=your_secure_admin_password
```

#### Setup Instructions:

1. **Local Development:**
   - Copy `.env.example` to `.env`
   - Replace placeholder values with your own secure credentials
   - The `.env` file is already in `.gitignore` (do not remove!)

2. **Production Deployment:**
   - Set environment variables on your hosting platform (Render, Heroku, etc.)
   - Never include `.env` file in production builds
   - Use strong, randomly generated passwords (min 12 characters)

### 2. **Database Credentials**

```bash
# Change from default in .env
DB_PASSWORD=change_me_to_secure_password
```

### 3. **JWT Secret**

```bash
# Use a long, random string (min 32 characters)
JWT_SECRET=use_a_long_randomly_generated_string_here
```

Generate a secure JWT secret:
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### 4. **AWS S3 Credentials**

```bash
AWS_ACCESS_KEY_ID=your_key
AWS_SECRET_ACCESS_KEY=your_secret
```

- Use IAM roles instead of access keys when possible
- Restrict S3 bucket policies to only necessary operations
- Enable bucket versioning and encryption

### 5. **CORS Configuration**

In production, set CORS to your frontend domain only:
```bash
CORS_ORIGIN=https://yourdomain.com
```

### 6. **Running the Seed Script**

After configuring environment variables, run:

```bash
npm run seed
```

This will:
- Create the admin user with the credentials from `.env`
- Use bcrypt to hash the password (never stored in plain text)
- Log only a confirmation message (no credentials exposed)

### 7. **Password Security**

- All passwords are hashed using bcrypt (12 rounds)
- Plain-text passwords are never logged or exposed
- Use strong passwords: mix of uppercase, lowercase, numbers, symbols
- Recommended minimum length: 12 characters

### 8. **Git Security Checklist**

- ✅ `.env` file is in `.gitignore`
- ✅ No hardcoded credentials in source code
- ✅ No credentials in logs or console output
- ✅ Environment-based configuration for all sensitive data
- ✅ `.env.example` shows placeholder values only

### 9. **Environment Variables Checklist**

Before deployment, ensure all these are set:

```bash
# Server
PORT=5000
NODE_ENV=production

# Database
DB_HOST=your_host
DB_PORT=5432
DB_NAME=hospital_dms
DB_USER=your_user
DB_PASSWORD=your_secure_password

# JWT
JWT_SECRET=your_long_random_secret
JWT_EXPIRES_IN=8h

# Admin (Set before first run)
ADMIN_EMPLOYEE_ID=your_admin_id
ADMIN_PASSWORD=your_admin_password

# AWS S3
AWS_REGION=ap-south-1
AWS_ACCESS_KEY_ID=your_key
AWS_SECRET_ACCESS_KEY=your_secret
S3_BUCKET_NAME=your_bucket

# CORS
CORS_ORIGIN=https://yourdomain.com

# Logging
LOG_LEVEL=info
```

### 10. **Regular Security Practices**

1. **Rotate Credentials** - Periodically change admin passwords and JWT secrets
2. **Monitor Logs** - Check for suspicious login attempts
3. **Update Dependencies** - Keep npm packages updated for security patches
4. **Use HTTPS** - Always use HTTPS in production
5. **Rate Limiting** - Enabled by default to prevent brute-force attacks
6. **Audit Logs** - Review audit logs regularly for unauthorized access

### 11. **If Credentials Are Exposed**

1. Immediately change all exposed credentials
2. Rotate JWT_SECRET
3. Reset all admin and user passwords
4. Review audit logs for unauthorized access
5. Update credentials on all deployment platforms

---

**Last Updated:** May 6, 2026  
**Status:** ✅ Credentials now environment-based and secure
