// ===== PDF.js loaded via <script> tag, available as pdfjsLib global =====

// ===== DOM Elements =====
var dropZone = document.getElementById('dropZone');
var pdfInput = document.getElementById('pdfInput');
var fileInfo = document.getElementById('fileInfo');
var fileNameEl = document.getElementById('fileName');
var loadingIndicator = document.getElementById('loadingIndicator');
var dataSection = document.getElementById('dataSection');
var tableBody = document.getElementById('tableBody');
var totalPkgsEl = document.getElementById('totalPkgs');
var totalWeightEl = document.getElementById('totalWeight');
var printBtn = document.getElementById('printBtn');
var resetBtn = document.getElementById('resetBtn');
var addRowBtn = document.getElementById('addRowBtn');
var currentSequenceInput = document.getElementById('currentSequenceInput');
var dateShiftInput = document.getElementById('dateShiftInput');
var saveSettingsBtn = document.getElementById('saveSettingsBtn');
var reportCounter = document.getElementById('reportCounter');
var nextReportNum = document.getElementById('nextReportNum');
var rowCountEl = document.getElementById('rowCount');

// ===== State =====
var extractedData = {
    vessel: '',
    reportNo: '',
    containerNo: '',
    auxCode: '',
    location: '',
    port: 'CHENNAI',
    sealNo: '',
    ac: '',
    rows: []
};

// ===== localStorage for report number sequence =====
var REPORT_NUM_KEY = 'ssms_report_number';

function getNextReportNumber() {
    var stored = localStorage.getItem(REPORT_NUM_KEY);
    return stored ? parseInt(stored, 10) : null;
}

function setReportNumber(num) {
    localStorage.setItem(REPORT_NUM_KEY, num.toString());
    updateSequenceDisplay();
}

function incrementReportNumber() {
    var current = getNextReportNumber();
    if (current !== null) {
        setReportNumber(current + 1);
    }
}

function updateSequenceDisplay() {
    var num = getNextReportNumber();
    if (num !== null) {
        reportCounter.classList.remove('hidden');
        reportCounter.classList.add('flex');
        nextReportNum.textContent = num;
        currentSequenceInput.value = num;
    } else {
        reportCounter.classList.add('hidden');
        reportCounter.classList.remove('flex');
        currentSequenceInput.value = '';
    }
}

// ===== Date Shift LocalStorage =====
var DATE_SHIFT_KEY = 'ssms_date_shift';
var savedDateShift = localStorage.getItem(DATE_SHIFT_KEY);
if (savedDateShift) dateShiftInput.value = savedDateShift;

// ===== Init =====
updateSequenceDisplay();

saveSettingsBtn.addEventListener('click', function () {
    var val = parseInt(currentSequenceInput.value, 10);
    if (val && val > 0) {
        setReportNumber(val);
    }
    
    var dsVal = dateShiftInput.value;
    if (dsVal) {
        localStorage.setItem(DATE_SHIFT_KEY, dsVal);
    } else {
        localStorage.removeItem(DATE_SHIFT_KEY);
    }
});

// ===== Drop Zone =====
dropZone.addEventListener('click', function () { pdfInput.click(); });

dropZone.addEventListener('dragover', function (e) {
    e.preventDefault();
    dropZone.classList.add('drag-over');
});

dropZone.addEventListener('dragleave', function () {
    dropZone.classList.remove('drag-over');
});

dropZone.addEventListener('drop', function (e) {
    e.preventDefault();
    dropZone.classList.remove('drag-over');
    if (e.dataTransfer.files.length > 0) {
        handleFile(e.dataTransfer.files[0]);
    }
});

pdfInput.addEventListener('change', function (e) {
    if (e.target.files.length > 0) {
        handleFile(e.target.files[0]);
    }
});

// ===== File Handler =====
async function handleFile(file) {
    if (file.type !== 'application/pdf') {
        alert('Please upload a PDF file.');
        return;
    }

    fileNameEl.textContent = file.name;
    fileInfo.classList.remove('hidden');
    loadingIndicator.classList.remove('hidden');
    dataSection.classList.add('hidden');

    try {
        var arrayBuffer = await file.arrayBuffer();
        var pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;

        var allPages = [];
        for (var i = 1; i <= pdf.numPages; i++) {
            var page = await pdf.getPage(i);
            var content = await page.getTextContent();
            var strings = content.items.map(function (item) {
                return { text: item.str, x: Math.round(item.transform[4]), y: Math.round(item.transform[5]), width: Math.round(item.width) };
            });
            // Sort by Y (descending = top to bottom), then X (left to right)
            strings.sort(function (a, b) {
                var yDiff = b.y - a.y;
                if (Math.abs(yDiff) > 3) return yDiff;
                return a.x - b.x;
            });

            // Group items by line (similar Y values)
            var lines = [];
            var currentLine = [];
            var currentY = null;
            for (var j = 0; j < strings.length; j++) {
                var item = strings[j];
                if (currentY === null || Math.abs(item.y - currentY) > 3) {
                    if (currentLine.length > 0) {
                        lines.push(currentLine.map(function (it) { return it.text; }).join(' '));
                    }
                    currentLine = [item];
                    currentY = item.y;
                } else {
                    currentLine.push(item);
                }
            }
            if (currentLine.length > 0) {
                lines.push(currentLine.map(function (it) { return it.text; }).join(' '));
            }
            allPages.push(lines);
        }

        var fullText = allPages.map(function (lines) { return lines.join('\n'); }).join('\n===PAGE_BREAK===\n');

        console.log('--- FULL EXTRACTED TEXT ---');
        console.log(fullText);
        console.log('--- END EXTRACTED TEXT ---');

        parseManifestText(fullText, allPages);
        renderTable();
        loadingIndicator.classList.add('hidden');
        dataSection.classList.remove('hidden');

    } catch (error) {
        console.error('PDF parsing error:', error);
        alert('Error parsing PDF: ' + error.message);
        loadingIndicator.classList.add('hidden');
    }
}

// ===== Manifest Parser =====
function parseManifestText(fullText, allPages) {
    var allLines = fullText.split('\n');

    // --- A/C: Company name from the top center header (first line of first page) ---
    var acName = '';
    if (allPages.length > 0) {
        for (var i = 0; i < Math.min(allPages[0].length, 5); i++) {
            var line = allPages[0][i].trim();
            if (line.match(/(?:PVT\s*\.?\s*LTD|PRIVATE\s*LIMITED|LIMITED)/i) && !line.match(/importer/i)) {
                acName = line.replace(/\s+/g, ' ').trim().toUpperCase();
                break;
            }
        }
    }
    extractedData.ac = acName;

    // --- Vessel & Voyage ---
    // Pattern: "Vessel   : TS SHEKOU  Vessel Code   : TS   Voyage No   : 26002E"
    var vessel = '';
    var voyage = '';
    for (var i = 0; i < allLines.length; i++) {
        var line = allLines[i].trim();
        if (line.indexOf('===PAGE_BREAK===') !== -1) continue;

        // Pattern: "Vessel : XXX ... Voyage No : YYY"
        var m = line.match(/Vessel\s*:\s*([A-Z0-9\s]+?)\s+(?:Vessel\s*Code|Voyage)/i);
        if (m) {
            vessel = m[1].trim();
        }
        var v = line.match(/Voyage\s*(?:No\.?\s*)?:\s*(\S+)/i);
        if (v) {
            voyage = v[1].trim();
        }
        if (vessel && voyage) break;
    }
    extractedData.vessel = (vessel && voyage) ? (vessel + '/' + voyage) : (vessel || voyage || '');

    // --- Report No ---
    var reportNum = getNextReportNumber();
    extractedData.reportNo = reportNum ? ('SSMS/' + reportNum + '/2026') : 'SSMS//2026';

    // --- Container No, Seal No, CFS Code, ISO Code ---
    // Pattern: "SKHU6452064   LCL   007345   ...   ECCT CFS 45G0   N"
    var containerNo = '';
    var sealNo = '';
    var cfsCode = '';
    var isoCode = '';
    for (var i = 0; i < allLines.length; i++) {
        var line = allLines[i].trim();
        // Container row: starts with container number pattern XXXX1234567, has LCL, seal, etc.
        var containerRowMatch = line.match(/([A-Z]{4}\d{7})\s+LCL\s+(\S+)/i);
        if (containerRowMatch) {
            containerNo = containerRowMatch[1].toUpperCase();
            sealNo = containerRowMatch[2];

            // Extract CFS Code - look for known pattern like "ECCT CFS" or similar
            var cfsMatch = line.match(/(\S+\s+CFS|CFS\s+\S+)/i);
            if (cfsMatch) {
                cfsCode = cfsMatch[1].trim().toUpperCase();
            }

            // Extract ISO Code - look for 45G0, 22G0, etc.
            var isoMatch = line.match(/\b(45G0|22G0|45G1|22G1|40G0|40G1|20G0|20G1)\b/);
            if (isoMatch) {
                isoCode = isoMatch[1].toUpperCase();
            }
            break;
        }
    }
    extractedData.containerNo = containerNo;
    extractedData.sealNo = sealNo;
    extractedData.location = cfsCode;

    // --- AUX Code mapping ---
    if (isoCode === '45G0') {
        extractedData.auxCode = '45G1 (40 HC)';
    } else if (isoCode === '22G0') {
        extractedData.auxCode = '22G1 (20GP)';
    } else if (isoCode) {
        extractedData.auxCode = isoCode;
    } else {
        extractedData.auxCode = '';
    }

    // --- Port of Discharge ---
    extractedData.port = 'CHENNAI';

    // --- Extract row data (Subline-based) ---
    extractSublineData(allLines);

    // --- Populate UI header fields ---
    document.getElementById('editVessel').value = extractedData.vessel;
    document.getElementById('editReportNo').value = extractedData.reportNo;
    document.getElementById('editContainer').value = extractedData.containerNo;
    document.getElementById('editAuxCode').value = extractedData.auxCode;
    document.getElementById('editLocation').value = extractedData.location;
    document.getElementById('editPort').value = extractedData.port;
    document.getElementById('editSealNo').value = extractedData.sealNo;
    document.getElementById('editAC').value = extractedData.ac;
}

function extractSublineData(allLines) {
    var entries = [];
    var currentEntry = null;

    // Track what we're collecting across lines
    var collectingImporter = false;
    var importerBuf = [];
    var collectingCommodity = false;
    var commodityBuf = [];

    for (var i = 0; i < allLines.length; i++) {
        var line = allLines[i].trim();
        if (!line || line === '===PAGE_BREAK===') {
            if (collectingImporter) { collectingImporter = false; }
            if (collectingCommodity) { collectingCommodity = false; }
            continue;
        }

        // --- Detect Subline entry ---
        // Pattern: "Subline No : 1   HBL Number : SNKO020260311423   HBL Date : 15-MAR-26"
        // Or:      "Subline No   : 1   HBL Number   : SNKO020260311423   HBL Date : 15-MAR-26"
        var sublineMatch = line.match(/Sub\s*line\s*No\s*:\s*(\d+)\s+HBL\s*Number\s*:\s*(\S+)\s+HBL\s*Date\s*:\s*(\S+)/i);
        if (sublineMatch) {
            // Flush previous entry
            if (currentEntry) {
                flushEntry(currentEntry, importerBuf, commodityBuf);
                entries.push(currentEntry);
            }
            currentEntry = {
                lineNo: '',
                sublineNo: sublineMatch[1],
                hblNumber: sublineMatch[2],
                hblDate: sublineMatch[3],
                importerName: '',
                commodityDesc: '',
                totalPackages: '0',
                grossWeight: '0'
            };
            importerBuf = [];
            commodityBuf = [];
            collectingImporter = false;
            collectingCommodity = false;
            continue;
        }

        // Also handle "Subline No : X" without HBL on same line (fallback)
        var sublineOnly = line.match(/Sub\s*line\s*No\s*:\s*(\d+)/i);
        if (sublineOnly && !sublineMatch) {
            if (currentEntry) {
                flushEntry(currentEntry, importerBuf, commodityBuf);
                entries.push(currentEntry);
            }
            currentEntry = {
                lineNo: '',
                sublineNo: sublineOnly[1],
                hblNumber: '',
                hblDate: '',
                importerName: '',
                commodityDesc: '',
                totalPackages: '0',
                grossWeight: '0'
            };
            importerBuf = [];
            commodityBuf = [];
            collectingImporter = false;
            collectingCommodity = false;

            // Try to get HBL from rest of line
            var hblM = line.match(/HBL\s*Number\s*:\s*(\S+)/i);
            if (hblM) currentEntry.hblNumber = hblM[1];
            var hblD = line.match(/HBL\s*Date\s*:\s*(\S+)/i);
            if (hblD) currentEntry.hblDate = hblD[1];
            continue;
        }

        if (!currentEntry) {
            // Extract Line No from pre-subline context
            // Pattern: "Line No   : 320   BL Number   : ..."
            var lineNoMatch = line.match(/Line\s*No\s*:\s*(\d+)/i);
            if (lineNoMatch) {
                // Store for next subline
                currentEntry = null; // will be set when subline found
                // We'll back-patch the line number
            }
            continue;
        }

        // --- If collecting commodity description ---
        if (collectingCommodity) {
            // Stop on known field headers
            if (line.match(/^(Marks\s*Number|Importer|Consignee|Container\s*No|Ref:|Page\s+\d|Line\s*No|Sub\s*line|Total\s*Package|Gross\s*Weight|Item\s*Type|Nature|Dest\s*Code)/i)) {
                collectingCommodity = false;
                // fall through to parse this line
            } else {
                commodityBuf.push(line);
                continue;
            }
        }

        // --- If collecting importer address lines ---
        if (collectingImporter) {
            // Stop on known field headers
            if (line.match(/^(Container\s*No|Ref:|Page\s+\d|Line\s*No|Sub\s*line|Commodity|HBL|Total\s*Package|Gross\s*Weight|Item\s*Type|Nature|Dest\s*Code|Mode\s*of|Port\s*of|Bond|Marks\s*Number)/i)) {
                collectingImporter = false;
                // fall through
            } else {
                importerBuf.push(line);
                continue;
            }
        }

        // --- Line No is handled by backfillLineNumbers ---
        // Skip "Line No" lines to avoid false matches
        if (line.match(/^Line\s*No\s*:/i)) {
            continue;
        }

        // --- HBL Number (if not captured in subline line) ---
        if (!currentEntry.hblNumber) {
            var hblM = line.match(/HBL\s*Number\s*:\s*(\S+)/i);
            if (hblM) { currentEntry.hblNumber = hblM[1]; continue; }
        }
        if (!currentEntry.hblDate) {
            var hblD = line.match(/HBL\s*Date\s*:\s*(\S+)/i);
            if (hblD) { currentEntry.hblDate = hblD[1]; continue; }
        }

        // --- Total Packages ---
        // Pattern: "Total Packages   : 3   Gross Weight   : 2000.000"
        var pkgMatch = line.match(/Total\s*Package[s]?\s*:\s*(\d+)/i);
        if (pkgMatch) {
            currentEntry.totalPackages = pkgMatch[1];
        }

        // --- Marks Number ---
        var marksMatch = line.match(/Marks\s*Number\s*:\s*(.*)/i);
        if (marksMatch) {
            currentEntry.marks = marksMatch[1].trim();
            continue;
        }

        // --- Gross Weight ---
        var weightMatch = line.match(/Gross\s*Weight\s*:\s*([\d.,]+)/i);
        if (weightMatch) {
            var w = weightMatch[1].replace(/,/g, '');
            currentEntry.grossWeight = parseFloat(w).toFixed(3);
            continue; // The rest of this line usually has "Unit : KGS"
        }

        // --- Commodity Description ---
        // Pattern: "Commodity Desc   : GEAR BOX AS PER BL"
        var commodityMatch = line.match(/Commodity\s*Desc\s*:?\s*(.*)/i);
        if (commodityMatch) {
            var descText = commodityMatch[1].trim();
            if (descText) commodityBuf.push(descText);
            collectingCommodity = true;
            continue;
        }

        // --- Importer's Name & Address ---
        // Pattern: "Importer's Name & Address   Consignee's Name & Address"
        if (line.match(/Importer/i) && line.match(/Address/i)) {
            collectingImporter = true;
            importerBuf = [];
            continue;
        }
    }

    // Flush last entry
    if (currentEntry) {
        flushEntry(currentEntry, importerBuf, commodityBuf);
        entries.push(currentEntry);
    }

    // Backfill Line Numbers: scan all entries, if lineNo blank, look back in text
    // Actually, let's scan the text for "Line No : XXX" that appears before subline entries
    backfillLineNumbers(entries, allLines);

    // Build output rows
    extractedData.rows = entries.map(function (entry, index) {
        var lno = (entry.lineNo && entry.sublineNo) ? (entry.lineNo + '-' + entry.sublineNo) : (entry.lineNo || entry.sublineNo || '');
        var hbl = '';
        if (entry.hblNumber && entry.hblDate) {
            hbl = entry.hblNumber + ' ' + entry.hblDate;
        } else if (entry.hblNumber) {
            hbl = entry.hblNumber;
        }

        var weightVal = parseFloat(entry.grossWeight) || 0;

        return {
            sno: index + 1,
            lno: lno,
            marks: entry.marks || '',
            hbl: hbl,
            importerName: entry.importerName || '',
            description: entry.commodityDesc || '',
            pkgs: entry.totalPackages || '',
            weight: weightVal.toFixed(3),
            remarks: 'APPARENT SOUND CONDITIONS'
        };
    });
}

function flushEntry(entry, importerBuf, commodityBuf) {
    // --- Finalize commodity description ---
    if (commodityBuf.length > 0) {
        var desc = commodityBuf.join(' ').replace(/\s+/g, ' ').trim().toUpperCase();
        // Remove "AS PER BL"
        desc = desc.replace(/\bAS\s+PER\s+BL\b/gi, '').trim();
        entry.commodityDesc = desc;
    }

    // --- Finalize importer name ---
    if (importerBuf.length > 0) {
        // The importer lines contain both importer and consignee side by side.
        // First line after "Importer's Name & Address ..." is the company name (may be duplicated for consignee).
        // We need just the LEFT half (importer) not the right half (consignee).

        // Strategy: The first importer line usually has the company name repeated.
        // e.g. "ROTORK CONTROLS INDIA PVT LTD   ROTORK CONTROLS INDIA PVT LTD"
        // Get just the first half by finding the midpoint duplication.

        var firstLine = importerBuf[0].trim().toUpperCase();

        // Try to find duplicated company name
        var companyName = extractLeftHalf(firstLine);

        // Build full address from remaining lines (left half only)
        var addressParts = [];
        for (var k = 1; k < importerBuf.length; k++) {
            var leftHalf = extractLeftHalf(importerBuf[k].trim().toUpperCase());
            if (leftHalf) addressParts.push(leftHalf);
        }

        var fullAddress = addressParts.join(' ');

        // Extract city from address
        var city = extractCity(fullAddress);

        if (city) {
            entry.importerName = companyName + ', ' + city;
        } else {
            entry.importerName = companyName;
        }
    }
}

function extractLeftHalf(line) {
    // Attempt to split the line in half (importer | consignee are side by side)
    // Strategy 1: If the line contains the same text repeated, take the first occurrence
    var half = Math.floor(line.length / 2);

    // Check if left half and right half are similar (within some tolerance)
    var left = line.substring(0, half).trim();
    var right = line.substring(half).trim();

    // If they're very similar (>60% overlap), just use the left half
    if (left.length > 5 && right.length > 5) {
        // Simple check: does the right half start similarly to the left?
        var leftWords = left.split(/\s+/);
        var rightWords = right.split(/\s+/);

        var matchCount = 0;
        var minLen = Math.min(leftWords.length, rightWords.length);
        for (var w = 0; w < minLen; w++) {
            if (leftWords[w] === rightWords[w]) matchCount++;
        }

        if (minLen > 0 && matchCount / minLen > 0.5) {
            return left;
        }
    }

    // Strategy 2: Look for large gaps (multiple spaces) to split
    var gapMatch = line.match(/^(.+?)\s{3,}(.+)$/);
    if (gapMatch) {
        return gapMatch[1].trim();
    }

    // Fallback: return full line
    return line;
}

function extractCity(addressText) {
    var cities = [
        'MUMBAI', 'DELHI', 'NEW DELHI', 'CHENNAI', 'BANGALORE', 'BENGALURU',
        'KOLKATA', 'HYDERABAD', 'PUNE', 'AHMEDABAD', 'SURAT', 'JAIPUR',
        'LUCKNOW', 'KANPUR', 'NAGPUR', 'VISAKHAPATNAM', 'INDORE', 'THANE',
        'BHOPAL', 'PATNA', 'VADODARA', 'GHAZIABAD', 'LUDHIANA', 'AGRA',
        'NASHIK', 'COIMBATORE', 'MADURAI', 'VARANASI', 'MEERUT', 'FARIDABAD',
        'RAJKOT', 'NOIDA', 'GURGAON', 'GURUGRAM', 'KOCHI', 'COCHIN',
        'THIRUVANANTHAPURAM', 'TRIVANDRUM', 'MANGALORE', 'MANGALURU',
        'MYSORE', 'MYSURU', 'SALEM', 'TIRUPUR', 'TIRUPPUR', 'HOSUR',
        'ERODE', 'VELLORE', 'TUTICORIN', 'THOOTHUKUDI', 'PONDICHERRY',
        'PUDUCHERRY', 'NAVI MUMBAI', 'BARODA', 'CHANDIGARH', 'JAMSHEDPUR',
        'RANCHI', 'RAIPUR', 'BHUBANESWAR', 'GUWAHATI', 'DEHRADUN',
        'JODHPUR', 'UDAIPUR', 'KOTA', 'SILIGURI', 'DURGAPUR', 'WARANGAL',
        'GUNTUR', 'VIJAYAWADA', 'CHENGALPATTU', 'KANCHEEPURAM', 'SANGAREDDY',
        'MEDCHAL', 'SUNGUVARCHATIRAM', 'SRI CITY'
    ];

    for (var c = 0; c < cities.length; c++) {
        if (addressText.indexOf(cities[c]) !== -1) {
            return cities[c];
        }
    }

    // Try to detect from state mention
    var states = {
        'KARNATAKA': 'BANGALORE', 'TAMIL NADU': 'CHENNAI', 'TAMILNADU': 'CHENNAI',
        'MAHARASHTRA': 'MUMBAI', 'TELANGANA': 'HYDERABAD', 'ANDHRA PRADESH': 'SRI CITY'
    };
    for (var state in states) {
        if (addressText.indexOf(state) !== -1) {
            return states[state];
        }
    }

    return '';
}

function backfillLineNumbers(entries, allLines) {
    // Scan the full text to find "Line No : XXX" entries and assign to subsequent sublines.
    // Always overwrite lineNo since the sequential scan is more reliable than inline parsing.
    var currentLineNo = '';
    var sublineIndex = 0;

    for (var i = 0; i < allLines.length; i++) {
        var line = allLines[i].trim();
        // Only match "Line No : 320" - exclude "Subline No" by checking the line doesn't contain "Sub"
        var m = line.match(/Line\s*No\s*:\s*(\d+)/i);
        if (m && !line.match(/Sub\s*line/i)) {
            currentLineNo = m[1];
        }
        var s = line.match(/Sub\s*line\s*No\s*:\s*(\d+)/i);
        if (s && sublineIndex < entries.length) {
            // Always assign the current line number
            entries[sublineIndex].lineNo = currentLineNo;
            sublineIndex++;
        }
    }
}

// ===== Table Rendering =====
function renderTable() {
    tableBody.innerHTML = '';

    extractedData.rows.forEach(function (row, index) {
        var tr = document.createElement('tr');
        tr.className = 'group';
        tr.innerHTML =
            '<td class="px-3 py-1.5 text-surface-400 font-mono">' + row.sno + '</td>' +
            '<td class="px-3 py-1.5"><input type="text" value="' + escapeHtml(row.lno) + '" data-field="lno" data-index="' + index + '" class="font-mono"></td>' +
            '<td class="px-3 py-1.5"><input type="text" value="' + escapeHtml(row.marks) + '" data-field="marks" data-index="' + index + '"></td>' +
            '<td class="px-3 py-1.5"><input type="text" value="' + escapeHtml(row.hbl) + '" data-field="hbl" data-index="' + index + '" class="font-mono"></td>' +
            '<td class="px-3 py-1.5"><input type="text" value="' + escapeHtml(row.importerName) + '" data-field="importerName" data-index="' + index + '"></td>' +
            '<td class="px-3 py-1.5"><input type="text" value="' + escapeHtml(row.description) + '" data-field="description" data-index="' + index + '"></td>' +
            '<td class="px-3 py-1.5"><input type="text" value="' + escapeHtml(row.pkgs) + '" data-field="pkgs" data-index="' + index + '" class="font-mono text-right w-14"></td>' +
            '<td class="px-3 py-1.5"><input type="text" value="' + escapeHtml(row.weight) + '" data-field="weight" data-index="' + index + '" class="font-mono text-right"></td>' +
            '<td class="px-3 py-1.5"><input type="text" value="' + escapeHtml(row.remarks) + '" data-field="remarks" data-index="' + index + '"></td>' +
            '<td class="px-3 py-1.5 text-center">' +
                '<button class="delete-row-btn w-6 h-6 rounded bg-red-500/10 hover:bg-red-500/20 text-red-400 hover:text-red-300 inline-flex items-center justify-center transition-all" data-index="' + index + '">' +
                    '<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg>' +
                '</button>' +
            '</td>';
        tableBody.appendChild(tr);
    });

    // Attach event listeners
    tableBody.querySelectorAll('input').forEach(function (input) {
        input.addEventListener('change', handleCellEdit);
        input.addEventListener('input', handleCellEdit);
    });

    tableBody.querySelectorAll('.delete-row-btn').forEach(function (btn) {
        btn.addEventListener('click', function (e) {
            var idx = parseInt(e.currentTarget.dataset.index);
            extractedData.rows.splice(idx, 1);
            extractedData.rows.forEach(function (r, i) { r.sno = i + 1; });
            renderTable();
        });
    });

    updateTotals();
    rowCountEl.textContent = extractedData.rows.length + ' rows';
}

function handleCellEdit(e) {
    var index = parseInt(e.target.dataset.index);
    var field = e.target.dataset.field;
    var value = e.target.value;

    extractedData.rows[index][field] = value;
    updateTotals();
}

function updateTotals() {
    var pkgsSum = 0;
    var weightSum = 0;

    extractedData.rows.forEach(function (row) {
        pkgsSum += parseInt(row.pkgs) || 0;
        weightSum += parseFloat(row.weight) || 0;
    });

    totalPkgsEl.textContent = pkgsSum;
    totalWeightEl.textContent = weightSum.toFixed(3) + ' KGS';
}

function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ===== Add Row =====
addRowBtn.addEventListener('click', function () {
    var newSno = extractedData.rows.length + 1;
    extractedData.rows.push({
        sno: newSno,
        lno: '',
        marks: '',
        hbl: '',
        importerName: '',
        description: '',
        pkgs: 0,
        weight: '0.000',
        remarks: 'APPARENT SOUND CONDITIONS'
    });
    renderTable();
});

// ===== Reset =====
resetBtn.addEventListener('click', function () {
    if (confirm('Are you sure you want to reset? All data will be lost.')) {
        extractedData = {
            vessel: '', reportNo: '', containerNo: '', auxCode: '',
            location: '', port: 'CHENNAI', sealNo: '', ac: '', rows: []
        };
        dataSection.classList.add('hidden');
        fileInfo.classList.add('hidden');
        pdfInput.value = '';
        tableBody.innerHTML = '';
    }
});

// ===== Print Report =====
printBtn.addEventListener('click', function () {
    generatePrintReport();
    setTimeout(function () { window.print(); }, 300);
    incrementReportNumber();
});

function generatePrintReport() {
    var vessel = document.getElementById('editVessel').value;
    var reportNo = document.getElementById('editReportNo').value;
    var container = document.getElementById('editContainer').value;
    var auxCode = document.getElementById('editAuxCode').value;
    var location = document.getElementById('editLocation').value;
    var port = document.getElementById('editPort').value;
    var sealNo = document.getElementById('editSealNo').value;
    var ac = document.getElementById('editAC').value;

    var pkgsSum = 0;
    var weightSum = 0;
    extractedData.rows.forEach(function (row) {
        pkgsSum += parseInt(row.pkgs) || 0;
        weightSum += parseFloat(row.weight) || 0;
    });

    // Manual Pagination Logic
    var maxRowsFirstPage = 15;
    var maxRowsOtherPages = 24;
    var chunks = [];
    var currentChunk = [];
    
    extractedData.rows.forEach(function (row, index) {
        currentChunk.push(row);
        var limit = (chunks.length === 0) ? maxRowsFirstPage : maxRowsOtherPages;
        if (currentChunk.length >= limit || index === extractedData.rows.length - 1) {
            chunks.push(currentChunk);
            currentChunk = [];
        }
    });

    var colGroupHtml = '<colgroup>' +
        '<col style="width:30px">' +
        '<col style="width:40px">' +
        '<col style="width:60px">' +
        '<col style="width:80px">' +
        '<col style="width:auto">' +
        '<col style="width:auto">' +
        '<col style="width:35px">' +
        '<col style="width:60px">' +
        '<col style="width:auto">' +
    '</colgroup>';
    
    var theadHtml = '<thead>' +
        '<tr>' +
            '<th>S.NO</th>' +
            '<th>L.NO</th>' +
            '<th>MARKS &amp; NO</th>' +
            '<th>H.B.L No/Date</th>' +
            '<th>IMPORTER NAME</th>' +
            '<th>DESCRIPTION</th>' +
            '<th>PKGS</th>' +
            '<th>WEIGHT</th>' +
            '<th>REMARKS</th>' +
        '</tr>' +
    '</thead>';

    var headerAndInfoHtml = 
        '<div class="report-header">' +
            '<h2><u>SUNSHINE MARINE SURVEYORS</u></h2>' +
            '<h3>OLD NO 14, NEW NO 27.M.K.B NAGAR 18<sup>TH</sup> WEST CROSS STREET CH-39</h3>' +
            '<h4><u>IMPORT - DE STUFFING REPORT</u></h4>' +
        '</div>' +
        '<table class="report-info">' +
            '<tr>' +
                '<td class="label">VESSEL NAME/ VOYAGE</td>' +
                '<td class="value">: ' + escapeHtml(vessel) + '</td>' +
                '<td class="label">REPORT NO</td>' +
                '<td class="value">: ' + escapeHtml(reportNo) + '</td>' +
            '</tr>' +
            '<tr>' +
                '<td class="label">CONTAINER NO</td>' +
                '<td class="value">: ' + escapeHtml(container) + '</td>' +
                '<td class="label">DATE &amp; SHIFT</td>' +
                '<td class="value">: ' + escapeHtml(document.getElementById('dateShiftInput').value) + '</td>' +
            '</tr>' +
            '<tr>' +
                '<td class="label">AUX CODE</td>' +
                '<td class="value">: ' + escapeHtml(auxCode) + '</td>' +
                '<td class="label">LOCATION</td>' +
                '<td class="value">: ' + escapeHtml(location) + '</td>' +
            '</tr>' +
            '<tr>' +
                '<td class="label">PORT OF DISCHARGE</td>' +
                '<td class="value">: ' + escapeHtml(port) + '</td>' +
                '<td class="label">SEAL NO</td>' +
                '<td class="value">: ' + escapeHtml(sealNo) + '</td>' +
            '</tr>' +
            '<tr>' +
                '<td class="label"></td>' +
                '<td class="value"></td>' +
                '<td class="label">A/C</td>' +
                '<td class="value">: ' + escapeHtml(ac) + '</td>' +
            '</tr>' +
        '</table>';

    var pagesHtml = '';

    chunks.forEach(function(chunk, pageIndex) {
        var isFirstPage = (pageIndex === 0);
        var isLastPage = (pageIndex === chunks.length - 1);
        
        var rowsHtml = '';
        chunk.forEach(function (row) {
            var weightStr = (parseFloat(row.weight) || 0).toFixed(3) + '<br>KGS';
            var hblHtml = escapeHtml(row.hbl).replace(' ', '<br>');
            var remarksStr = 'APPARENT&nbsp;SOUND<br>CONDITIONS';
            var pkgsStr = escapeHtml(row.pkgs).replace(' ', '<br>');
            
            rowsHtml +=
                '<tr>' +
                    '<td class="center">' + row.sno + '</td>' +
                    '<td class="center">' + escapeHtml(row.lno) + '</td>' +
                    '<td>' + escapeHtml(row.marks) + '</td>' +
                    '<td>' + hblHtml + '</td>' +
                    '<td>' + escapeHtml(row.importerName) + '</td>' +
                    '<td>' + escapeHtml(row.description) + '</td>' +
                    '<td class="center">' + pkgsStr + '</td>' +
                    '<td class="center">' + weightStr + '</td>' +
                    '<td>' + remarksStr + '</td>' +
                '</tr>';
        });

        if (isLastPage) {
            rowsHtml +=
                '<tr>' +
                    '<td colspan="6" style="text-align:right; font-weight:bold;">TOTAL</td>' +
                    '<td style="text-align:center; font-weight:bold;">' + pkgsSum + '</td>' +
                    '<td style="text-align:center; font-weight:bold;">' + weightSum.toFixed(3) + '</td>' +
                    '<td></td>' +
                '</tr>';
        }

        var tableHtml = '<table class="report-table">' + colGroupHtml + (isFirstPage ? theadHtml : '') + '<tbody>' + rowsHtml + '</tbody></table>';

        var pageTop = isFirstPage ? headerAndInfoHtml : ('<div style="text-align: right; font-weight: bold; font-size: 10pt; margin-bottom: 15px; padding-right: 5mm;">Page-' + (pageIndex + 1) + '</div>');

        var sigImgHtml = '';
        var sigPad = document.getElementById('signaturePad');
        if (sigPad && !isCanvasBlank(sigPad)) {
            sigImgHtml = '<img src="' + sigPad.toDataURL('image/png') + '" style="height: 50px; display: block; margin-left: auto; margin-bottom: 2px;"/>';
        }

        var footerHtml = isLastPage ? (
            '<div style="page-break-inside: avoid;">' +
                '<div class="report-footer" style="margin-top: 20px; font-size: 8pt; text-align: left; padding: 0 5mm;">' +
                    '<p style="margin:4px 0;">CONTAINER FLOOR BOARD ON GOUGED AT PLACES.</p>' +
                    '<p style="margin:4px 0;">Issued without Prejudice</p>' +
                    '<p style="margin:5px 0; max-width: 80%; line-height: 1.4;">This report is made on the basis of our inspection to the best of our skill and knowledge and as per findings at the time and place of inspection and the report is issued subject to the condition that neither firm nor any of its Surveyors agents is under any circumstances to be held responsible for any inaccuracy in report or for Certificate issued for or any error of Judgment, default or negligence.</p>' +
                '</div>' +
                '<div style="text-align: right; margin-top: 5px; font-size: 9pt; font-weight: bold; padding-right: 5mm;">' +
                    sigImgHtml +
                    'SURVEYORS' +
                '</div>' +
            '</div>'
        ) : '';
        
        var pageStyle = 'page-break-after: always;' + (isFirstPage ? '' : ' padding-top: 15mm; padding-right: 5mm; padding-left: 5mm;');
        
        pagesHtml += '<div class="print-page" style="' + pageStyle + '">' + pageTop + tableHtml + footerHtml + '</div>';
    });

    var printTemplate = document.getElementById('printTemplate');
    printTemplate.innerHTML = pagesHtml;
}

// --- Signature Pad Logic ---
var signaturePad = document.getElementById('signaturePad');
var sigCtx = signaturePad ? signaturePad.getContext('2d') : null;
var isDrawing = false;
var lastX = 0;
var lastY = 0;

function getCoordinates(e) {
    var rect = signaturePad.getBoundingClientRect();
    if (e.touches && e.touches.length > 0) {
        return { x: e.touches[0].clientX - rect.left, y: e.touches[0].clientY - rect.top };
    }
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
}

function startDrawing(e) {
    isDrawing = true;
    var coords = getCoordinates(e);
    lastX = coords.x;
    lastY = coords.y;
    e.preventDefault(); // Prevent scrolling on touch
}

function draw(e) {
    if (!isDrawing) return;
    var coords = getCoordinates(e);
    sigCtx.beginPath();
    sigCtx.moveTo(lastX, lastY);
    sigCtx.lineTo(coords.x, coords.y);
    sigCtx.strokeStyle = '#000000';
    sigCtx.lineWidth = 2;
    sigCtx.lineCap = 'round';
    sigCtx.stroke();
    lastX = coords.x;
    lastY = coords.y;
    e.preventDefault();
}

function stopDrawing() {
    isDrawing = false;
}

if (signaturePad) {
    // Mouse events
    signaturePad.addEventListener('mousedown', startDrawing);
    signaturePad.addEventListener('mousemove', draw);
    signaturePad.addEventListener('mouseup', stopDrawing);
    signaturePad.addEventListener('mouseout', stopDrawing);

    // Touch events for mobile
    signaturePad.addEventListener('touchstart', startDrawing, {passive: false});
    signaturePad.addEventListener('touchmove', draw, {passive: false});
    signaturePad.addEventListener('touchend', stopDrawing);

    document.getElementById('clearSignatureBtn').addEventListener('click', function(e) {
        e.preventDefault();
        sigCtx.clearRect(0, 0, signaturePad.width, signaturePad.height);
    });
}

function isCanvasBlank(canvas) {
    var blank = document.createElement('canvas');
    blank.width = canvas.width;
    blank.height = canvas.height;
    return canvas.toDataURL() === blank.toDataURL();
}
