/**
 * ExportManager
 * Handles data export functionality (JSON, CSV, Excel, Audit Report, Annotated PDF)
 */

import * as XLSX from 'xlsx';
import AppStateManager from '../state/AppStateManager';
import FormManager from '../forms/FormManager';
import ExtractionTracker from '../data/ExtractionTracker';
import StatusManager from '../utils/status';

/**
 * ExportManager Object
 * Central manager for all export operations
 */
const ExportManager = {
    /**
     * Export extraction data as JSON with full provenance metadata
     * Includes document metadata, form data, all extractions with coordinates,
     * citation map, text chunks, and bounding box data
     */
    exportJSON: function() {
        const state = AppStateManager.getState();
        const formData = FormManager.collectFormData();
        const extractions = ExtractionTracker.getExtractions();
        
        // Enhanced data structure with provenance
        const data = {
            version: '2.0',
            document: state.documentName,
            exportDate: new Date().toISOString(),
            totalPages: state.totalPages,
            formData,
            extractions: extractions.map(ext => ({
                ...ext,
                // Ensure coordinates are included
                coordinates: {
                    x: ext.coordinates?.x || ext.coordinates?.left || 0,
                    y: ext.coordinates?.y || ext.coordinates?.top || 0,
                    width: ext.coordinates?.width || 0,
                    height: ext.coordinates?.height || 0
                },
                // Add provenance metadata
                provenance: {
                    method: ext.method,
                    timestamp: ext.timestamp,
                    page: ext.page,
                    hasCoordinates: !!(ext.coordinates?.x || ext.coordinates?.left)
                }
            })),
            // Include citation map if available
            citationMap: state.citationMap || {},
            // Include text chunks for citation lookup
            textChunks: state.textChunks?.map(chunk => ({
                index: chunk.index,
                text: chunk.text.substring(0, 200), // Truncate for export
                pageNum: chunk.pageNum,
                bbox: chunk.bbox
            })) || [],
            // Include extracted figures and tables metadata
            metadata: {
                extractedFigures: state.extractedFigures?.length || 0,
                extractedTables: state.extractedTables?.length || 0,
                extractionCount: extractions.length,
                uniqueFields: new Set(extractions.map(e => e.fieldName)).size
            }
        };
        
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        this.downloadFile(blob, `extraction_${Date.now()}.json`);
        StatusManager.show('JSON export successful with provenance metadata', 'success');
    },

    /**
     * Export extraction data as CSV
     * Includes field name, text, page, coordinates, and timestamp
     */
    exportCSV: function() {
        let csv = 'Field,Text,Page,X,Y,Width,Height,Timestamp\n';
        ExtractionTracker.getExtractions().forEach(ext => {
            csv += `"${ext.fieldName}","${ext.text.replace(/"/g, '""')}",${ext.page},${ext.coordinates.x},${ext.coordinates.y},${ext.coordinates.width},${ext.coordinates.height},"${ext.timestamp}"\n`;
        });
        const blob = new Blob([csv], { type: 'text/csv' });
        this.downloadFile(blob, `extraction_${Date.now()}.csv`);
        StatusManager.show('CSV export successful (Preview)', 'success');
    },

    /**
     * Generate and export audit report as HTML
     * Opens in new tab with document metadata, form data, and extractions
     */
    exportAudit: function() {
        const formData = FormManager.collectFormData();
        // Generate simplified HTML locally for preview
        const state = AppStateManager.getState();
        const extractions = ExtractionTracker.getExtractions();
        let html = `<h1>Audit Report</h1><h2>Document: ${state.documentName}</h2><h3>Form Data</h3><ul>`;
        Object.entries(formData).forEach(([key, value]) => html += `<li><b>${key}:</b> ${value}</li>`);
        html += `</ul><h3>Extractions</h3>`;
        extractions.forEach(ext => html += `<p><b>${ext.fieldName} (Page ${ext.page}):</b> "${ext.text}" <i>@ ${ext.timestamp}</i></p>`);
        const blob = new Blob([html], { type: 'text/html' });
        const url = URL.createObjectURL(blob);
        window.open(url, '_blank');
        setTimeout(() => URL.revokeObjectURL(url), 1000); // Clean up blob URL
        StatusManager.show('Audit report generated (Preview)', 'success');
    },

    /**
     * Export data as Excel (.xlsx) file with multiple sheets
     * Creates professional Excel workbook with:
     * - Summary sheet with form data
     * - Extractions sheet with all extraction details
     * - Statistics sheet with extraction counts
     */
    exportExcel: function() {
        const state = AppStateManager.getState();
        const formData = FormManager.collectFormData();
        const extractions = ExtractionTracker.getExtractions();

        // Create new workbook
        const workbook = XLSX.utils.book_new();

        // SHEET 1: Summary (Form Data)
        const summaryData = [
            ['Clinical Extractor - Data Export'],
            [''],
            ['Document:', state.documentName],
            ['Export Date:', new Date().toLocaleString()],
            ['Total Extractions:', extractions.length],
            [''],
            ['Form Data'],
            ['Field', 'Value']
        ];

        // Add form data rows
        Object.entries(formData).forEach(([key, value]) => {
            summaryData.push([key, String(value)]);
        });

        const summarySheet = XLSX.utils.aoa_to_sheet(summaryData);
        XLSX.utils.book_append_sheet(workbook, summarySheet, 'Summary');

        // SHEET 2: Extractions (Detailed)
        const extractionsData: (string | number)[][] = [
            ['Field Name', 'Extracted Text', 'Page', 'Method', 'X', 'Y', 'Width', 'Height', 'Timestamp']
        ];

        extractions.forEach(ext => {
            extractionsData.push([
                ext.fieldName,
                ext.text,
                ext.page,
                ext.method,
                ext.coordinates.x || ext.coordinates.left || 0,
                ext.coordinates.y || ext.coordinates.top || 0,
                ext.coordinates.width,
                ext.coordinates.height,
                new Date(ext.timestamp).toLocaleString()
            ]);
        });

        const extractionsSheet = XLSX.utils.aoa_to_sheet(extractionsData);
        XLSX.utils.book_append_sheet(workbook, extractionsSheet, 'Extractions');

        // SHEET 3: Statistics
        const uniquePages = new Set(extractions.map(e => e.page));
        const methodCounts = extractions.reduce((acc, ext) => {
            acc[ext.method] = (acc[ext.method] || 0) + 1;
            return acc;
        }, {} as Record<string, number>);

        const statsData = [
            ['Extraction Statistics'],
            [''],
            ['Metric', 'Value'],
            ['Total Extractions', extractions.length],
            ['Pages with Data', uniquePages.size],
            ['Unique Fields', new Set(extractions.map(e => e.fieldName)).size],
            [''],
            ['Extraction Methods'],
            ['Method', 'Count']
        ];

        Object.entries(methodCounts).forEach(([method, count]) => {
            statsData.push([method, count]);
        });

        const statsSheet = XLSX.utils.aoa_to_sheet(statsData);
        XLSX.utils.book_append_sheet(workbook, statsSheet, 'Statistics');

        // Generate Excel file and trigger download
        const excelBuffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' });
        const blob = new Blob([excelBuffer], {
            type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        });

        this.downloadFile(blob, `clinical_extraction_${Date.now()}.xlsx`);
        StatusManager.show('✓ Excel file exported successfully!', 'success');
    },

    /**
     * Export annotated PDF with extraction highlights
     * Not available in preview mode
     */
    exportAnnotatedPDF: function() {
        StatusManager.show('Annotated PDF export not available in preview.', 'info');
    },

    /**
     * Export provenance data with complete coordinate metadata
     * Includes all extraction coordinates, bounding boxes, and citation information
     */
    exportProvenance: function() {
        const state = AppStateManager.getState();
        const formData = FormManager.collectFormData();
        const extractions = ExtractionTracker.getExtractions();

        const provenanceData = {
            document: {
                name: state.documentName,
                totalPages: state.totalPages,
                loadDate: state.documentName ? new Date().toISOString() : null,
            },
            exportDate: new Date().toISOString(),
            formData,
            extractions: extractions.map(ext => ({
                id: ext.id,
                fieldName: ext.fieldName,
                text: ext.text,
                page: ext.page,
                method: ext.method,
                timestamp: ext.timestamp,
                coordinates: {
                    x: ext.coordinates.x || ext.coordinates.left || 0,
                    y: ext.coordinates.y || ext.coordinates.top || 0,
                    width: ext.coordinates.width,
                    height: ext.coordinates.height,
                },
                boundingBox: {
                    x: ext.coordinates.x || ext.coordinates.left || 0,
                    y: ext.coordinates.y || ext.coordinates.top || 0,
                    width: ext.coordinates.width,
                    height: ext.coordinates.height,
                },
            })),
            citations: state.citationMap ? Object.entries(state.citationMap).map(([index, chunk]: [string, any]) => ({
                index: parseInt(index),
                text: chunk.text,
                pageNum: chunk.pageNum,
                bbox: chunk.bbox,
                section: chunk.section,
            })) : [],
            textChunks: state.textChunks ? state.textChunks.map((chunk: any) => ({
                index: chunk.index,
                text: chunk.text,
                pageNum: chunk.pageNum,
                bbox: chunk.bbox,
                section: chunk.section,
                isHeading: chunk.isHeading,
            })) : [],
            metadata: {
                totalExtractions: extractions.length,
                extractionMethods: extractions.reduce((acc: Record<string, number>, ext) => {
                    acc[ext.method] = (acc[ext.method] || 0) + 1;
                    return acc;
                }, {}),
                pagesWithExtractions: [...new Set(extractions.map(e => e.page))],
            },
        };

        const blob = new Blob([JSON.stringify(provenanceData, null, 2)], { type: 'application/json' });
        this.downloadFile(blob, `provenance_${state.documentName || 'extraction'}_${Date.now()}.json`);
        StatusManager.show('Provenance export successful', 'success');
    },

    /**
     * Download file helper
     * Creates temporary download link and triggers download
     * @private
     */
    downloadFile: function(blob: Blob, filename: string) {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a); // Required for Firefox
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000); // Clean up blob URL
    }
};

/**
 * Individual export functions for window binding
 */
export function exportJSON() {
    ExportManager.exportJSON();
}

export function exportCSV() {
    ExportManager.exportCSV();
}

export function exportExcel() {
    ExportManager.exportExcel();
}

export function exportAudit() {
    ExportManager.exportAudit();
}

export function exportAnnotatedPDF() {
    ExportManager.exportAnnotatedPDF();
}

export function exportProvenance() {
    ExportManager.exportProvenance();
}

export default ExportManager;
