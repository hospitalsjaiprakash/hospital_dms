const fs = require('fs');
const file = '/home/jpdms/hospital_dms/frontend/src/pages/PatientsPage.jsx';
let content = fs.readFileSync(file, 'utf8');

function robustReplace(desc, regex, replacement) {
  if (!regex.test(content)) {
    console.error('Failed to match: ' + desc);
    process.exit(1);
  }
  content = content.replace(regex, replacement);
}

// 1. Add X import
robustReplace(
  'X import',
  /import \{ Search, Plus, Users, ChevronRight, Download \} from 'lucide-react';/,
  "import { Search, Plus, Users, ChevronRight, Download, X } from 'lucide-react';"
);

// 2. Wrap the header
robustReplace(
  'Wrap Header',
  /\{\/\* Table Header - Desktop \*\/\}\s*<div\s*className="hidden sm:grid/,
  '<div className="overflow-x-auto w-full rounded-t-xl">\n              <div className="min-w-[1000px]">\n                {/* Table Header - Desktop */}\n                <div\n                  className="grid'
);

// 3. Close the wrappers
robustReplace(
  'Close Wrappers',
  /<\/div>\s*\{pagination && \(/,
  '</div>\n              </div>\n            </div>\n\n            {pagination && ('
);

// 4. Update row container
robustReplace(
  'Row container',
  /className={`flex sm:grid gap-3/g,
  'className={`grid gap-3'
);

// 5. Remove UHID mobile text
content = content.replace(/<p className="text-xs text-gray-400 sm:hidden">\{patient\.uhid\}<\/p>/g, '');

// 6. Remove Badge mobile
content = content.replace(/<div className="flex sm:hidden flex-col gap-1 mr-3">[\s\S]*?<\/div>/g, '');

// 7. Remove hidden sm:flex
content = content.replace(/className="hidden sm:flex /g, 'className="flex ');
content = content.replace(/className={`hidden sm:flex/g, 'className={`flex');

// 8. Replace col spans
content = content.replace(/sm:col-span-/g, 'col-span-');

fs.writeFileSync(file, content);
console.log('Success');
