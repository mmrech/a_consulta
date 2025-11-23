/**
 * TableExtractor.ts
 *
 * Extracts tables from PDF using geometric detection algorithm.
 * Implements the methodology from pdf-data-extraction-guide.md
 *
 * Key technique: Tables aren't stored as tables in PDFs - they're just text
 * positioned to look like grids. This service reconstructs table structure by
 * analyzing text item positions (Y-clustering for rows, X-clustering for columns).
 */

interface TextItem {
    text: string
    x: number
    y: number
    width: number
    height: number
    fontName: string
}

interface BoundingBox {
    x: number
    y: number
    width: number
    height: number
}

interface ExtractedTable {
    id: string
    pageNum: number
    headers: string[]
    rows: string[][]
    rawGrid: string[][]
    columnPositions: number[]
    boundingBox: BoundingBox
    extractionMethod: string
}

class TableExtractor {
    /**
     * Extract all tables from a PDF page using geometric detection
     */
    async extractTablesFromPage(page: any, pageNum: number): Promise<ExtractedTable[]> {
        // Step 1: Get text with positions
        const textItems = await this.extractTextWithPositions(page)

        // Step 2: Group into rows
        const rows = this.groupItemsByRow(textItems)

        // Step 3: Detect table regions
        const tableRegions = this.detectTableRegions(rows)

        // Step 4: Convert to structured format
        const tables = tableRegions.map((region, idx) => {
            const structured = this.convertToStructuredTable(region)

            return {
                id: `table-${pageNum}-${idx + 1}`,
                pageNum,
                ...structured,
                extractionMethod: 'geometric_detection',
            }
        })

        return tables
    }

    /**
     * Step 1: Extract text items with coordinate data
     */
    private async extractTextWithPositions(page: any): Promise<TextItem[]> {
        const textContent = await page.getTextContent()
        const viewport = page.getViewport({ scale: 1.0 })

        return textContent.items.map((item: any) => ({
            text: item.str,
            x: item.transform[4],
            y: viewport.height - item.transform[5],  // Flip Y axis
            width: item.width,
            height: item.height,
            fontName: item.fontName,
        }))
    }

    /**
     * Step 2: Group text items into rows based on Y-coordinate
     * Items with similar Y values (within tolerance) belong to the same row
     * TIGHTENED: Reduced tolerance from 5 to 3 for tighter row grouping
     */
    private groupItemsByRow(items: TextItem[], tolerance = 3): TextItem[][] {
        // Sort by Y coordinate
        const sorted = [...items].sort((a, b) => a.y - b.y)

        const rows: TextItem[][] = []
        let currentRow: TextItem[] = []
        let lastY = -Infinity

        sorted.forEach(item => {
            if (Math.abs(item.y - lastY) > tolerance) {
                // New row detected
                if (currentRow.length > 0) {
                    rows.push(currentRow.sort((a, b) => a.x - b.x))  // Sort by X
                }
                currentRow = [item]
                lastY = item.y
            } else {
                // Same row - add to current
                currentRow.push(item)
            }
        })

        // Don't forget the last row
        if (currentRow.length > 0) {
            rows.push(currentRow.sort((a, b) => a.x - b.x))
        }

        return rows
    }

    /**
     * Step 3: Detect column positions by clustering X coordinates
     * Items that align vertically (similar X positions) form columns
     * TIGHTENED: Reduced tolerance from 10 to 8 for better column detection
     */
    private detectColumnPositions(row: TextItem[], tolerance = 8): number[] {
        const positions = row.map(item => item.x)

        // Cluster nearby X positions
        const clusters: number[][] = []

        positions.forEach(pos => {
            const existingCluster = clusters.find(cluster =>
                cluster.some(p => Math.abs(p - pos) < tolerance)
            )

            if (existingCluster) {
                existingCluster.push(pos)
            } else {
                clusters.push([pos])
            }
        })

        // Return average of each cluster (the column position)
        return clusters
            .map(cluster => cluster.reduce((sum, val) => sum + val, 0) / cluster.length)
            .sort((a, b) => a - b)
    }

    /**
     * Step 4: Find table regions by detecting grid patterns
     * A table is: multiple consecutive rows with aligned columns
     * 
     * TIGHTENED CRITERIA to reduce false positives:
     * - Minimum 4 columns (was 3)
     * - Minimum 3 rows (was 2)
     * - Minimum table width/height requirements
     * - Better alignment validation
     */
    private detectTableRegions(rows: TextItem[][]): any[] {
        const tableRegions: any[] = []
        let currentTable: any = null

        rows.forEach((row, rowIndex) => {
            const columnPositions = this.detectColumnPositions(row)

            // TIGHTENED: Require at least 4 columns (was 3)
            // This filters out regular paragraphs with 3+ words
            const hasMultipleColumns = columnPositions.length >= 4
            
            // TIGHTENED: Require better alignment (80% instead of 70%)
            const alignsWithTable = currentTable &&
                this.alignsWithColumns(columnPositions, currentTable.columnPositions, 10, 0.8)

            if (alignsWithTable) {
                // Continue existing table
                currentTable.rows.push(row)
            } else if (hasMultipleColumns) {
                // Start new table
                // TIGHTENED: Require at least 3 rows (was 2)
                if (currentTable && currentTable.rows.length >= 3) {
                    // Additional validation: check table size
                    if (this.isValidTable(currentTable)) {
                        tableRegions.push(currentTable)
                    }
                }
                currentTable = {
                    startRow: rowIndex,
                    rows: [row],
                    columnPositions: columnPositions,
                }
            } else {
                // Not a table row - end current table if exists
                if (currentTable && currentTable.rows.length >= 3) {
                    if (this.isValidTable(currentTable)) {
                        tableRegions.push(currentTable)
                    }
                }
                currentTable = null
            }
        })

        // Don't forget the last table
        if (currentTable && currentTable.rows.length >= 3) {
            if (this.isValidTable(currentTable)) {
                tableRegions.push(currentTable)
            }
        }

        return tableRegions
    }

    /**
     * Validate that a table region meets minimum size requirements
     * Filters out tiny "tables" that are just formatted text
     */
    private isValidTable(tableRegion: any): boolean {
        if (!tableRegion.rows || tableRegion.rows.length < 3) {
            return false
        }

        // Calculate bounding box
        const allItems = tableRegion.rows.flat()
        if (allItems.length === 0) {
            return false
        }

        const xs = allItems.map((item: TextItem) => item.x)
        const rights = allItems.map((item: TextItem) => item.x + item.width)
        const ys = allItems.map((item: TextItem) => item.y)
        const bottoms = allItems.map((item: TextItem) => item.y + item.height)

        const minX = Math.min(...xs)
        const maxX = Math.max(...rights)
        const minY = Math.min(...ys)
        const maxY = Math.max(...bottoms)

        const width = maxX - minX
        const height = maxY - minY

        // TIGHTENED: Require minimum table dimensions
        // Tables should be at least 200px wide and 50px tall
        const minWidth = 200
        const minHeight = 50

        if (width < minWidth || height < minHeight) {
            return false
        }

        // Additional check: table should have reasonable aspect ratio
        // Very wide or very tall regions are likely not tables
        const aspectRatio = width / height
        if (aspectRatio > 10 || aspectRatio < 0.1) {
            return false
        }

        // Check that we have multiple distinct columns
        // If all columns are too close together, it's probably not a table
        const columnPositions = tableRegion.columnPositions
        if (columnPositions.length < 4) {
            return false
        }

        // Check column spacing - columns should be reasonably spaced
        let hasGoodSpacing = false
        for (let i = 1; i < columnPositions.length; i++) {
            const spacing = columnPositions[i] - columnPositions[i - 1]
            if (spacing > 30) { // At least 30px between columns
                hasGoodSpacing = true
                break
            }
        }

        return hasGoodSpacing
    }

    /**
     * Check if column positions align with existing table columns
     * TIGHTENED: At least 80% of positions must align within tolerance (was 70%)
     * Tighter tolerance for better accuracy
     */
    private alignsWithColumns(
        positions: number[],
        tableColumns: number[],
        tolerance = 10,  // TIGHTENED: Reduced from 15 to 10
        minAlignmentRatio = 0.8  // TIGHTENED: Increased from 0.7 to 0.8
    ): boolean {
        if (positions.length === 0 || tableColumns.length === 0) {
            return false
        }

        const aligned = positions.filter(pos =>
            tableColumns.some(col => Math.abs(pos - col) < tolerance)
        )

        return aligned.length >= positions.length * minAlignmentRatio
    }

    /**
     * Step 5: Convert table region to structured grid format
     */
    private convertToStructuredTable(tableRegion: any): Omit<ExtractedTable, 'id' | 'pageNum' | 'extractionMethod'> {
        const rows = tableRegion.rows
        const columnPositions = tableRegion.columnPositions

        // Create empty grid
        const grid: string[][] = []

        rows.forEach(row => {
            const gridRow: string[] = new Array(columnPositions.length).fill('')

            row.forEach((item: TextItem) => {
                // Find which column this item belongs to
                const colIndex = this.findClosestColumn(item.x, columnPositions)

                // Concatenate text if multiple items in same cell
                gridRow[colIndex] = (gridRow[colIndex] + ' ' + item.text).trim()
            })

            grid.push(gridRow)
        })

        // First row is typically headers
        const headers = grid[0]
        const dataRows = grid.slice(1)

        return {
            headers,
            rows: dataRows,
            rawGrid: grid,
            columnPositions,
            boundingBox: this.calculateBoundingBox(rows.flat()),
        }
    }

    /**
     * Find the closest column index for a given X position
     */
    private findClosestColumn(x: number, columns: number[]): number {
        let minDist = Infinity
        let closestIdx = 0

        columns.forEach((col, idx) => {
            const dist = Math.abs(x - col)
            if (dist < minDist) {
                minDist = dist
                closestIdx = idx
            }
        })

        return closestIdx
    }

    /**
     * Calculate bounding box that encompasses all text items
     */
    private calculateBoundingBox(items: TextItem[]): BoundingBox {
        const xs = items.map(i => i.x)
        const ys = items.map(i => i.y)
        const rights = items.map(i => i.x + i.width)
        const bottoms = items.map(i => i.y + i.height)

        return {
            x: Math.min(...xs),
            y: Math.min(...ys),
            width: Math.max(...rights) - Math.min(...xs),
            height: Math.max(...bottoms) - Math.min(...ys),
        }
    }

    /**
     * Generate HTML table for preview/export
     */
    generateHTMLTable(table: ExtractedTable): string {
        let html = '<table class="extracted-table">'

        // Headers
        if (table.headers && table.headers.length > 0) {
            html += '<thead><tr>'
            table.headers.forEach((header: string) => {
                html += `<th>${header}</th>`
            })
            html += '</tr></thead>'
        }

        // Body
        html += '<tbody>'
        table.rows.forEach((row: string[]) => {
            html += '<tr>'
            row.forEach((cell: string) => {
                html += `<td>${cell}</td>`
            })
            html += '</tr>'
        })
        html += '</tbody></table>'

        return html
    }

    /**
     * Generate CSV for export
     */
    generateCSV(table: ExtractedTable): string {
        const escapeCSV = (cell: any) => {
            if (cell == null) return '""'
            const str = String(cell)
            if (str.includes(',') || str.includes('"') || str.includes('\n')) {
                return `"${str.replace(/"/g, '""')}"`
            }
            return `"${str}"`
        }

        let csv = ''

        // Headers
        if (table.headers) {
            csv += table.headers.map(escapeCSV).join(',') + '\n'
        }

        // Rows
        table.rows.forEach((row: string[]) => {
            csv += row.map(escapeCSV).join(',') + '\n'
        })

        return csv
    }
}

// Export singleton instance
export default new TableExtractor()
export type { ExtractedTable, TextItem, BoundingBox }
