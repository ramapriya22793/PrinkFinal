const fs = require('fs');
const path = 'c:/Users/CHENNAMMAL/Downloads/Prink-main (5) (1)/Prink-main (5)/Prink-main/apps/customer/src/components/CustomerPortal.tsx';
let content = fs.readFileSync(path, 'utf8');

// 1. Update the progress bar to only have Upload and Preview
content = content.replace(
  `{[
                    { n: 1, label: 'Select' },
                    { n: 2, label: 'Upload' },
                    { n: 3, label: 'Preview' },
                    { n: 4, label: 'Review' },
                    { n: 5, label: 'Done' },
                  ]`,
  `{[
                    { n: 2, label: 'Upload' },
                    { n: 3, label: 'Preview' }
                  ]`
);

// 2. Change the Next button on Step 3 to ALWAYS be Submit Design for all products
const oldStep3Button = `{ (isButterfly(activeOrder) || isMagazine(activeOrder)) ? (
                      <button 
                        className="wiz-btn-next" 
                        disabled={isSubmitting}
                        onClick={async () => {
                          setIsSubmitting(true);
                          await handleSubmitDesign();
                          setIsSubmitting(false);
                          goWizard(5, 'forward');
                        }}
                      >
                        {isSubmitting ? (
                          <><div style={{ display: 'inline-block', width: 14, height: 14, border: '2px solid rgba(255,255,255,0.3)', borderTop: '2px solid #fff', borderRadius: '50%', animation: 'spin 0.8s linear infinite', marginRight: 6 }} /> Submitting...</>
                        ) : (
                          <>Submit Design <i className="bi bi-check-circle" /></>
                        )}
                      </button>
                    ) : (
                      <button className="wiz-btn-next" onClick={() => goWizard(4, 'forward')}>
                        Review Design <i className="bi bi-arrow-right" />
                      </button>
                    )}`;

const newStep3Button = `<button 
                      className="wiz-btn-next" 
                      disabled={isSubmitting}
                      onClick={async () => {
                        setIsSubmitting(true);
                        await handleSubmitDesign();
                        setIsSubmitting(false);
                        goWizard(5, 'forward');
                      }}
                    >
                      {isSubmitting ? (
                        <><div style={{ display: 'inline-block', width: 14, height: 14, border: '2px solid rgba(255,255,255,0.3)', borderTop: '2px solid #fff', borderRadius: '50%', animation: 'spin 0.8s linear infinite', marginRight: 6 }} /> Submitting...</>
                      ) : (
                        <>Submit Design <i className="bi bi-check-circle" /></>
                      )}
                    </button>`;

content = content.replace(oldStep3Button, newStep3Button);


// 3. In Step 2 (Upload), if they skip preview, they also need to go to Step 5, not Step 4!
content = content.replace(
  `goWizard(reqPreview ? 3 : 4, 'forward');`,
  `if (reqPreview) {
                          goWizard(3, 'forward');
                        } else {
                          setIsSubmitting(true);
                          await handleSubmitDesign();
                          setIsSubmitting(false);
                          goWizard(5, 'forward');
                        }`
);

fs.writeFileSync(path, content);
console.log('Customer Portal Wizard simplified to 2 visible steps safely.');
