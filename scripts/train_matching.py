"""Train the bundled offline TF-IDF/LSA model on a synthetic complaint corpus.

Only needed to rebuild the model. Runtime inference is plain JavaScript.
Requires NumPy; no complaints or documents are sent outside this computer.
"""
import json
import re
from pathlib import Path
import numpy as np

TOPICS = {
 'Faculty pay': ['salary not paid', 'faculty remuneration pending', 'unpaid wages and payroll delay', 'staff compensation withheld', 'teacher salaries overdue', 'salary nahi mili vetan baki'],
 'Fee refund': ['tuition fee refund delayed', 'admission cancellation reimbursement pending', 'withdrawal payment return overdue', 'student deposit refund not processed', 'fees wapas nahi mile', 'cancelled admission money refund'],
 'Excess admissions': ['admissions exceeding approved intake', 'enrolment beyond sanctioned seats', 'unauthorised extra admissions capacity', 'student intake limit violated', 'approved seats se jyada admission', 'over admission in sanctioned programme'],
 'Laboratory facilities': ['laboratory equipment unavailable', 'practical lab instruments missing', 'science laboratory infrastructure shortage', 'technical lab apparatus deficient', 'laboratory equipment compliance', 'practical training equipment not working'],
 'Faculty credentials': ['faculty qualification mismatch', 'teacher degree certificate invalid', 'academic staff credentials inconsistent', 'faculty education records verification', 'teacher qualification documentation', 'professor eligibility degree discrepancy'],
 'Certificate retention': ['original certificates retained', 'academic documents not returned', 'institution withholding student certificates', 'original marksheets held after withdrawal', 'certificate wapas nahi diya', 'academic papers return refused'],
 'Accessibility': ['accessibility ramps unavailable', 'wheelchair access missing', 'disabled student entry facilities', 'barrier free campus accommodation', 'accessible facilities not provided', 'divyang ramp facility missing'],
 'Library resources': ['library books inadequate', 'academic journal subscriptions unavailable', 'library capacity below requirement', 'digital library resources missing', 'library reading facilities deficient', 'textbooks not available in library'],
 'Approval status': ['approval information outdated', 'recognition accreditation details incorrect', 'unauthorised programme recognition claim', 'approval status misrepresented online', 'institution accreditation website mismatch', 'approval certificate expired'],
 'Examination grievance': ['examination results delayed', 'exam assessment review request', 'marks evaluation discrepancy', 'examination appeal unanswered', 'exam result mein galti', 'examination grievance committee response'],
 'Harassment grievance': ['student harassment complaint', 'ragging intimidation reported', 'campus bullying concern', 'hostile treatment and harassment', 'student safety intimidation grievance', 'ragging complaint unresolved'],
 'Tuition fee dispute': ['excessive tuition fee charged', 'unapproved additional charges', 'unexpected fee increase', 'compulsory extra payment demanded', 'fees jyada li gayi', 'unapproved fee collection'],
}
STOP = 'a an the and or of to in for on at by is are was were be been being with from this that these those it as has have had not no nahi nahiin pending delayed missing unavailable complaint request student students institution institutional college institute report reported please after before records review details provided regarding issue programme technical academic'.split()
stop = set(STOP)
def words(s):
    return [w for w in re.findall(r'[a-z]+',s.lower()) if len(w)>2 and w not in stop]

docs=[]
for label,phrases in TOPICS.items():
    # Shared topic context connects alternative wordings without an external model.
    for i,p in enumerate(phrases):
        docs.append(p+' '+phrases[(i+1)%len(phrases)]+' '+label)
vocab=sorted({w for s in docs for w in words(s)})
index={w:i for i,w in enumerate(vocab)}
counts=np.zeros((len(docs),len(vocab)))
for i,s in enumerate(docs):
    for w in words(s): counts[i,index[w]]+=1
idf=np.log((1+len(docs))/(1+(counts>0).sum(axis=0)))+1
tfidf=(1+np.log(np.maximum(counts,1)))*(counts>0)*idf
tfidf/=np.maximum(np.linalg.norm(tfidf,axis=1,keepdims=True),1e-12)
_,_,vt=np.linalg.svd(tfidf,full_matrices=False)
projection=vt[:len(TOPICS)].T
prototypes={}
for label,phrases in TOPICS.items():
    x=np.zeros(len(vocab))
    for w in words(' '.join(phrases)):
        if w in index:x[index[w]]+=1
    v=((1+np.log(np.maximum(x,1)))*(x>0)*idf)@projection
    prototypes[label]=(v/max(np.linalg.norm(v),1e-12)).round(7).tolist()
model={'name':'Samanvay LSA v1','method':'TF-IDF + truncated SVD','training':'72 synthetic complaint documents across 12 topics; not a pretrained language model','stop':STOP,'vocab':vocab,'idf':idf.round(7).tolist(),'projection':projection.round(7).tolist(),'topics':prototypes}
target=Path(__file__).resolve().parents[1]/'src'/'matching-model.json'
target.write_text(json.dumps(model,separators=(',',':')),encoding='utf-8')
print(f'Saved {target.name}: {len(vocab)} terms, {len(TOPICS)} latent dimensions')
