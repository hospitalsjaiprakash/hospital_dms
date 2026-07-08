const axios = require('axios');

const sendToGSheet = async (action, payload) => {
  const webhookUrl = process.env.GSHEET_WEBHOOK_URL;
  if (!webhookUrl) {
    console.warn('GSHEET_WEBHOOK_URL not configured. Skipping Google Sheet sync.');
    return;
  }

  try {
    const data = {
      action: action,
      ...payload
    };

    // Google Apps Script requires following redirects
    await axios.post(webhookUrl, data, {
      maxRedirects: 5,
      validateStatus: function (status) {
        return status >= 200 && status < 400; // default
      }
    });

    console.log(`Successfully sent ${action} to Google Sheet Webhook.`);
  } catch (err) {
    console.error('Error syncing to Google Sheet:', err.message);
  }
};
module.exports = {
  sendToGSheet
};
