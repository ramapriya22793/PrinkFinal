const fs = require('fs');
const path = 'c:/Users/CHENNAMMAL/Downloads/Prink-main (5) (1)/Prink-main (5)/Prink-main/apps/customer/src/components/CustomerPortal.tsx';
let content = fs.readFileSync(path, 'utf8');

// 1. Fix text: "exactly 8 photos for your Magazine"
content = content.replace(
  /exactly 8 photos for your \{isMagazine\(activeOrder\) \? 'Magazine' : 'Butterfly Box'\}/g,
  "exactly {isMagazine(activeOrder) ? 4 : 8} photos for your {isMagazine(activeOrder) ? 'Magazine' : 'Butterfly Box'}"
);

// 2. Fix the info box in step 2
content = content.replace(
  /Please upload exactly 8 photos for your Butterfly Box\.<br \/>/g,
  "Please upload exactly {isMagazine(activeOrder) ? 4 : 8} photos for your {isMagazine(activeOrder) ? 'Magazine' : 'Butterfly Box'}.<br />"
);

// 3. Fix the validation on submit in step 3
content = content.replace(
  /if \(\(isButterfly\(activeOrder\) \|\| isMagazine\(activeOrder\)\)\) \{\s*if \(images\.length !== 8 && !selectedOccasionTheme\) \{\s*showToast\('The Butterfly Box template requires exactly 8 photos or a selected theme\.', 'warning'\);\s*return;\s*\}\s*\}/g,
  `if (isMagazine(activeOrder)) {
                          if (images.length !== 4 && !selectedOccasionTheme) {
                            showToast('The Magazine template requires exactly 4 photos or a selected theme.', 'warning');
                            return;
                          }
                        } else if (isButterfly(activeOrder)) {
                          if (images.length !== 8 && !selectedOccasionTheme) {
                            showToast('The Butterfly Box template requires exactly 8 photos or a selected theme.', 'warning');
                            return;
                          }
                        }`
);

fs.writeFileSync(path, content);
console.log('CustomerPortal updated to require 4 photos for Magazine.');
