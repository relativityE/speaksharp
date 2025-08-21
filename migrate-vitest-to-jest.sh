#!/bin/bash

# Find all test files and convert them
find src -name "*.test.*" -o -name "*.spec.*" | while read file; do
    echo "Converting $file..."

    # Replace vitest imports with jest imports
    sed -i "s/import { \([^}]*\) } from 'vitest'/import { \1 } from '@jest\/globals'/g" "$file"

    # Replace vi with jest
    sed -i 's/\bvi\./jest./g' "$file"
    sed -i 's/\bvi\b/jest/g' "$file"

    # Replace common vitest-specific patterns
    sed -i 's/jest\.mock/jest.mock/g' "$file"
    sed -i 's/jest\.fn/jest.fn/g' "$file"
    sed -i 's/jest\.clearAllMocks/jest.clearAllMocks/g' "$file"
    sed -i 's/jest\.resetAllMocks/jest.resetAllMocks/g' "$file"
    sed -i 's/jest\.restoreAllMocks/jest.restoreAllMocks/g' "$file"
done

echo "Migration complete!"
