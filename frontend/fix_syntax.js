const fs = require('fs');
const file = '/home/jpdms/hospital_dms/frontend/src/pages/PatientsPage.jsx';
let content = fs.readFileSync(file, 'utf8');

content = content.replace(
  '            </div>\n              </div>\n            </div>\n\n            {pagination && (',
  '            </div>\n              </div>\n\n            {pagination && ('
);

fs.writeFileSync(file, content);
console.log('Fixed');
