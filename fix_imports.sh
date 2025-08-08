#!/bin/bash

# Fix malformed imports in fill-detector files
find lib/fill-detector -name "*.ts" -exec sed -i '' 's/from '"'"'\.\/\./from '"'"'.\//g' {} \;
find lib/fill-detector -name "*.ts" -exec sed -i '' 's/from '"'"'\.$/from '"'"'.\//g' {} \;
find lib/fill-detector -name "*.ts" -exec sed -i '' 's/$/'"'"';/g' {} \;

# Fix specific patterns
find lib/fill-detector -name "*.ts" -exec sed -i '' 's/'"'"';'"'"';/'"'"';/g' {} \;
find lib/fill-detector -name "*.ts" -exec sed -i '' 's/}'"'"';$/}/g' {} \;
find lib/fill-detector -name "*.ts" -exec sed -i '' 's/describe('"'"';$/describe(/g' {} \;
find lib/fill-detector -name "*.ts" -exec sed -i '' 's/it('"'"';$/it(/g' {} \;
find lib/fill-detector -name "*.ts" -exec sed -i '' 's/expect('"'"';$/expect(/g' {} \;