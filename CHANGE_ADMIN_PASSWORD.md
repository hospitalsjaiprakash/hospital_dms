# 🔐 How to Change Admin Password

## Option 1: Change Password in Local Development

### Step 1: Update the .env file
```bash
# Navigate to backend folder
cd backend

# Open .env file
# Find this line:
ADMIN_PASSWORD=your_current_password

# Change it to your new password:
ADMIN_PASSWORD=your_new_secure_password
```

### Step 2: Run the seed script to update database
```bash
npm run seed
```

This will:
- Hash the new password with bcrypt
- Update the admin user in the database
- Log confirmation message

**Done!** ✅ Your new admin password is now active. Login with the new password.

---

## Option 2: Change Password in Production (Render/Vercel)

### Step 1: Update Environment Variable on Render

1. Go to your Render dashboard: https://render.onrender.com
2. Select your backend service
3. Click **Environment** tab
4. Find `ADMIN_PASSWORD` variable
5. Click the edit (pencil) icon
6. Enter your new password
7. Click **Save**

### Step 2: Run Seed Script on Render

You have two options:

#### Option A: Via Render Shell (Recommended)
1. On Render dashboard, click **Shell** tab
2. Run this command:
```bash
npm run seed
```
3. Wait for confirmation message

#### Option B: Trigger Deployment
1. Make any small change to your backend code (or just edit a comment)
2. Push to GitHub
3. Render will auto-deploy and run the seed script

**Done!** ✅ Your new admin password is now active in production.

---

## Option 3: Change Password Manually via Database

### If you have direct database access:

```sql
-- First, generate a bcrypt hash of your new password
-- Use an online tool like https://bcrypt-generator.com/
-- Or run this in Node.js:
-- const bcrypt = require('bcryptjs');
-- bcrypt.hash('your_new_password', 12).then(hash => console.log(hash));

-- Then update the database:
UPDATE users 
SET password_hash = '$2a$12$YOUR_BCRYPT_HASH_HERE'
WHERE role = 'admin' AND employee_id = 'YOUR_ADMIN_ID';
```

---

## 🔒 Security Best Practices

### ✅ DO:
- Use a strong password (12+ characters)
- Mix uppercase, lowercase, numbers, symbols
- Change password periodically
- Never share your password
- Use unique admin credentials

### ❌ DON'T:
- Use simple passwords (password123, admin123)
- Commit .env files to Git
- Share admin credentials via email/chat
- Use the same password for multiple accounts
- Tell anyone your admin password

---

## Example Strong Passwords:

✅ **Good Examples:**
- `Hospital@2026Secure#Admin`
- `J1phrc!2026$Secure`
- `Admin#Secure$2026Hospital`

❌ **Weak Examples:**
- `Admin13574` (exposed in old code)
- `admin123`
- `password`
- `12345678`

---

## ⚠️ If Your Password Was Compromised

1. **Immediately change password:**
   ```bash
   # Update .env
   ADMIN_PASSWORD=new_very_secure_password
   npm run seed
   ```

2. **Review Audit Logs:**
   - Check for unauthorized access attempts
   - Look for suspicious document uploads/downloads

3. **Notify Your Team:**
   - Inform about the security incident
   - Tell them to be alert for suspicious activity

4. **Change Other Credentials:**
   - Update JWT_SECRET
   - Reset database password if exposed
   - Change S3 credentials if exposed

---

## Troubleshooting

### Issue: "Seed failed" error

**Solution:**
- Make sure `ADMIN_EMPLOYEE_ID` is set in .env
- Make sure both `ADMIN_EMPLOYEE_ID` and `ADMIN_PASSWORD` are configured
- Check that environment variables are valid

### Issue: Can't login with new password

**Solution:**
- Verify password was changed in .env
- Verify seed script ran successfully (check logs)
- Clear browser cache and try again
- Make sure you're using the exact password you set

### Issue: Seed script says "Admin credentials not configured"

**Solution:**
- Check .env file has these lines:
```bash
ADMIN_EMPLOYEE_ID=your_admin_id
ADMIN_PASSWORD=your_new_password
```
- Make sure there are no spaces or typos
- Restart the application

---

## Quick Reference

| Task | Command | Location |
|------|---------|----------|
| Change local password | Edit `.env` then `npm run seed` | Backend folder |
| Change production password | Update Render env vars then trigger seed | Render dashboard |
| Generate bcrypt hash | Use online tool or Node.js | Online tool |
| View admin ID | Check `.env` for `ADMIN_EMPLOYEE_ID` | .env file |

---

**Last Updated:** May 6, 2026  
**Status:** ✅ All credentials now environment-based and secure
