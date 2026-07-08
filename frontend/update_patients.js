const fs = require('fs');
const file = '/home/jpdms/hospital_dms/frontend/src/pages/PatientsPage.jsx';
let content = fs.readFileSync(file, 'utf8');

// Add X import
content = content.replace(
  /import \{ Search, Plus, Users, ChevronRight, Download \} from 'lucide-react';/,
  "import { Search, Plus, Users, ChevronRight, Download, X } from 'lucide-react';"
);

// Wrap table
content = content.replace(
  /\/\* Table Header - Desktop \*\/\s*<div\s*className="hidden sm:grid/,
  '<div className="overflow-x-auto w-full rounded-t-xl">\n              <div className="min-w-[1000px]">\n                {/* Table Header */}\n                <div\n                  className="grid'
);

// Close the wrapper divs right before pagination
content = content.replace(
  /<\/div>\n\n\s*\{pagination && \(/,
  '</div>\n              </div>\n            </div>\n\n            {pagination && ('
);

// Change row container
content = content.replace(/className={`flex sm:grid gap-3/g, 'className={`grid gap-3');

// Remove sm:hidden uhid
content = content.replace(/<p className="text-xs text-gray-400 sm:hidden">\{patient\.uhid\}<\/p>\n/g, '');

// Remove mobile badges
content = content.replace(/<div className="flex sm:hidden flex-col gap-1 mr-3">\s*<Badge[^>]*>.*?<\/Badge>\s*<\/div>\n/g, '');

// Replace hidden sm:flex with flex
content = content.replace(/className="hidden sm:flex /g, 'className="flex ');
content = content.replace(/className={`hidden sm:flex/g, 'className={`flex');

// Replace sm:col-span- with col-span-
content = content.replace(/sm:col-span-/g, 'col-span-');

fs.writeFileSync(file, content);
console.log('Done');
