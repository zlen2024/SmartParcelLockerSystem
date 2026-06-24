import glob
import re

html_files = glob.glob('frontend/**/*.html', recursive=True)

for file in html_files:
    with open(file, 'r', encoding='utf-8') as f:
        content = f.read()
        
    content = re.sub(r'styles\.css\?v=\d+', 'styles.css?v=15', content)
    
    with open(file, 'w', encoding='utf-8') as f:
        f.write(content)
        
print('Done bumping CSS to v15')
