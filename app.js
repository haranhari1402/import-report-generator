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

        if (fullText.replace(/===PAGE_BREAK===/g, '').trim().length < 50) {
            document.getElementById('loadingStatus').textContent = 'Scanned PDF detected. Running OCR... This may take a minute.';
            var ocrText = '';
            var worker = await Tesseract.createWorker('eng');
            for (var i = 1; i <= pdf.numPages; i++) {
                document.getElementById('loadingStatus').textContent = 'Running OCR... Page ' + i + ' of ' + pdf.numPages;
                var page = await pdf.getPage(i);
                var viewport = page.getViewport({ scale: 2.0 });
                var canvas = document.createElement('canvas');
                var context = canvas.getContext('2d');
                canvas.height = viewport.height;
                canvas.width = viewport.width;
                await page.render({ canvasContext: context, viewport: viewport }).promise;
                var ret = await worker.recognize(canvas);
                ocrText += '\n===PAGE_BREAK===\n' + ret.data.text + '\n';
            }
            await worker.terminate();
            
            console.log('--- OCR EXTRACTED TEXT ---');
            console.log(ocrText);
            console.log('--- END OCR TEXT ---');
            
            parseOCRManifestText(ocrText);
        } else {
            console.log('--- FULL EXTRACTED TEXT ---');
            console.log(fullText);
            console.log('--- END EXTRACTED TEXT ---');
            
            parseManifestText(fullText, allPages);
        }
        renderTable();
        loadingIndicator.classList.add('hidden');
        dataSection.classList.remove('hidden');

    } catch (error) {
        console.error('PDF parsing error:', error);
        alert('Error parsing PDF: ' + error.message);
        loadingIndicator.classList.add('hidden');
        document.getElementById('loadingStatus').textContent = 'Parsing manifest PDF...';
    }
}

// ===== Manifest Parser =====
function parseManifestText(fullText, allPages) {
    var allLines = fullText.split('\n');

    // --- Company Detection ---
    // CARGO CONSOLIDATORS manifests have "CARGO CONSOLIDATORS" in header, "ECCT CFS" in container rows, or "cargoconsol" email
    // ALLTRANS manifests have generic "SEA CONSOL IGM PRINT" header with NO company name
    var isCARGO = fullText.match(/CARGO\s*CONSOLIDATORS/i) || fullText.match(/ECCT/i) || fullText.match(/cargoconsol/i);
    var companyPrefix = isCARGO ? 'CCIPL' : 'ATSLL';
    
    console.log('--- COMPANY DETECTION ---');
    console.log('Found CARGO CONSOLIDATORS:', !!fullText.match(/CARGO\s*CONSOLIDATORS/i));
    console.log('Found ECCT:', !!fullText.match(/ECCT/i));
    console.log('Found cargoconsol:', !!fullText.match(/cargoconsol/i));
    console.log('Detected company:', isCARGO ? 'CARGO CONSOLIDATORS' : 'ALLTRANS');
    
    var reportNum = getNextReportNumber() || '001';
    extractedData.reportNo = 'SSMS/' + companyPrefix + '/' + reportNum + '/2026';
    
    if (isCARGO) {
        extractedData.location = 'ECCT CFS';
        extractedData.ac = 'CARGO CONSOLIDATORS INDIA PVT LTD';
    } else {
        extractedData.location = 'SATTVA 2 CFS';
        extractedData.ac = 'ALLTRANS SHIPPING AND LOGISTICS LL';
    }

    // --- Vessel & Voyage ---
    var vessel = '';
    var voyage = '';
    for (var i = 0; i < allLines.length; i++) {
        var line = allLines[i].trim();
        if (line.indexOf('===PAGE_BREAK===') !== -1) continue;

        var vMatch = line.match(/Voyage\s*No\.?\s*:\s*(\S+)\s*Vessel\s*:\s*(.*)/i);
        if (vMatch) {
            voyage = vMatch[1].trim();
            vessel = vMatch[2].trim();
            break;
        }

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

    // --- Container No, Seal No, ISO Code ---
    var containerNo = '';
    var sealNo = '';
    var isoCode = '';
    for (var i = 0; i < allLines.length; i++) {
        var line = allLines[i].trim();
        
        var cMatch = line.match(/^\s*([A-Z]{4}\d{7})\s+(?:LCL|FCL)\s+(\S+)\s+\S+\s+[\d\.]+\s+\d+\s+(\d{4})/i);
        if (cMatch) {
            containerNo = cMatch[1].toUpperCase();
            sealNo = cMatch[2];
            isoCode = cMatch[3];
            break;
        }

        var containerRowMatch = line.match(/([A-Z]{4}\d{7})\s+LCL\s+(\S+)/i);
        if (containerRowMatch) {
            containerNo = containerRowMatch[1].toUpperCase();
            sealNo = containerRowMatch[2];

            var isoMatch = line.match(/\b(45G0|22G0|45G1|22G1|40G0|40G1|20G0|20G1)\b/);
            if (isoMatch) {
                isoCode = isoMatch[1].toUpperCase();
            }
            break;
        }
    }
    extractedData.containerNo = containerNo;
    extractedData.sealNo = sealNo;

    // --- AUX Code mapping ---
    if (isoCode === '4500' || isoCode === '4400' || isoCode === '45G0' || isoCode === '45G1') {
        extractedData.auxCode = '45G1 (40 HC)';
    } else if (isoCode === '2200' || isoCode === '22G0' || isoCode === '22G1') {
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
        var sublineMatch = line.match(/Sub\s*line\s*No\.?\s*:\s*(\d+)\s+HBL\s*Number\s*:\s*(\S+)\s+HBL\s*Date\s*:\s*(\S+)/i);
        if (sublineMatch) {
            // Flush previous entry
            if (currentEntry) {
                flushEntry(currentEntry, importerBuf, commodityBuf);
                entries.push(currentEntry);
            }
            
            var sNo = sublineMatch[1].replace(/"/g, '1').replace(/'/g, '1');
            if (line.match(/Sub\s*line\s*No\.?\s*:\s*\d+["']/i)) {
                sNo = sNo + '1';
            }

            currentEntry = {
                lineNo: '',
                sublineNo: sNo,
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
        var sublineOnly = line.match(/Sub\s*line\s*No\.?\s*:\s*(\d+)/i);
        if (sublineOnly && !sublineMatch) {
            if (currentEntry) {
                flushEntry(currentEntry, importerBuf, commodityBuf);
                entries.push(currentEntry);
            }
            
            var sNo = sublineOnly[1].replace(/"/g, '1').replace(/'/g, '1');
            if (line.match(/Sub\s*line\s*No\.?\s*:\s*\d+["']/i)) {
                sNo = sNo + '1';
            }

            currentEntry = {
                lineNo: '',
                sublineNo: sNo,
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
            var lineNoMatch = line.match(/Line\s*No\.?\s*:\s*(\d+)/i);
            if (lineNoMatch) {
                currentEntry = null; // will be set when subline found
            }
            continue;
        }

        // --- If collecting commodity description ---
        if (collectingCommodity) {
            // Stop on known field headers
            if (line.match(/^(Marks|Importer|Consignee|Container|Ref:|Page\s+\d|Line\s*No|Sub\s*line|Total\s*Package|Gross\s*Weight|Item\s*Type|Nature|Dest\s*Code|Goods\s*Desc)/i)) {
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
            if (line.match(/^(Container|Ref:|Page\s+\d|Line\s*No|Sub\s*line|Commodity|Goods\s*Desc|HBL|Total\s*Package|Gross\s*Weight|Item\s*Type|Nature|Dest\s*Code|Mode\s*of|Port\s*of|Bond|Marks)/i)) {
                collectingImporter = false;
                // fall through
            } else {
                importerBuf.push(line);
                continue;
            }
        }

        // Skip "Line No" lines to avoid false matches
        if (line.match(/^Line\s*No\.?\s*:/i)) {
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
        var pkgMatch = line.match(/Total\s*Package[s]?\s*:\s*(\d+)/i);
        if (pkgMatch) {
            currentEntry.totalPackages = pkgMatch[1];
        }

        // --- Marks Number ---
        var marksMatch = line.match(/Marks\s*(?:Number)?\s*:\s*(.*)/i);
        if (marksMatch) {
            currentEntry.marks = marksMatch[1].trim();
            continue;
        }

        // --- Gross Weight ---
        var weightMatch = line.match(/Gross\s*Weight\s*:\s*([\d.,]+)/i);
        if (weightMatch) {
            var w = weightMatch[1].replace(/,/g, '');
            currentEntry.grossWeight = parseFloat(w).toFixed(3);
            continue;
        }

        // --- Commodity Description ---
        var commodityMatch = line.match(/(?:Commodity|Goods)\s*Desc\s*:?\s*(.*)/i);
        if (commodityMatch) {
            var descText = commodityMatch[1].trim();
            if (descText) commodityBuf.push(descText);
            collectingCommodity = true;
            continue;
        }

        // --- Importer's Name & Address ---
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

    // Backfill Line Numbers
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

        var marks = entry.marks || '';
        marks = marks.replace(/\bAS\s+PER\s+BL\b/gi, '').trim();
        marks = marks.replace(/\bC\/(?:NO|O)\.?\s*\d+\b/gi, '').trim();

        var desc = entry.commodityDesc || '';
        desc = desc.replace(/\bAS\s+PER\s+BL\b/gi, '').trim();
        desc = desc.replace(/\bHS\s*CODE\b.*$/gi, '').trim();

        return {
            sno: index + 1,
            lno: lno,
            marks: marks,
            hbl: hbl,
            importerName: entry.importerName || '',
            description: desc,
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
        desc = desc.replace(/\bAS\s+PER\s+BL\b/gi, '').trim();
        entry.commodityDesc = desc;
    }

    // --- Finalize importer name ---
    if (importerBuf.length > 0) {
        var addressParts = [];
        var companyName = extractLeftHalf(importerBuf[0].trim().toUpperCase());
        for (var k = 1; k < importerBuf.length; k++) {
            var leftHalf = extractLeftHalf(importerBuf[k].trim().toUpperCase());
            leftHalf = leftHalf.replace(/\|\s*P\s*LTD/g, 'PVT LTD').replace(/\|\s*PVT\s*LTD/g, 'PVT LTD').replace(/\|\s*/g, '');
            if (leftHalf) addressParts.push(leftHalf);
        }

        companyName = companyName.replace(/\|\s*P\s*LTD/g, 'PVT LTD').replace(/\|\s*PVT\s*LTD/g, 'PVT LTD').replace(/\|\s*/g, '');

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
    var half = Math.floor(line.length / 2);

    var left = line.substring(0, half).trim();
    var right = line.substring(half).trim();

    if (left.length > 5 && right.length > 5) {
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

    var gapMatch = line.match(/^(.+?)\s{3,}(.+)$/);
    if (gapMatch) {
        return gapMatch[1].trim();
    }

    return line;
}

function extractCity(addressText) {
    var text = addressText.toUpperCase();
    
    var matches = text.match(/\b([A-Z]+\s+DISTRICT|[A-Z]+\s+DIST|TAMIL\s*NADU|TN|KANCHEEPURAM|KANCHIPURAM|THIRUVALLUR|SRIPERUMBUDUR|SRIPERUMBUDU|CHENNAI|BANGALORE|HYDERABAD|MUMBAI|PUNE)\b/);
    
    if (matches) {
        var match = matches[1].trim();
        if (match === 'TN') return 'TAMIL NADU';
        if (match === 'SRIPERUMBUDU') return 'SRIPERUMBUDUR';
        return match;
    }
    
    var cities = [
        'KOLKATA', 'AHMEDABAD', 'SURAT', 'JAIPUR', 'LUCKNOW', 'KANPUR', 'NAGPUR', 'VISAKHAPATNAM', 'INDORE', 'THANE', 'BHOPAL', 'PATNA', 'VADODARA', 'GHAZIABAD', 'LUDHIANA', 'AGRA', 'NASHIK', 'COIMBATORE', 'MADURAI', 'VARANASI', 'MEERUT', 'FARIDABAD', 'RAJKOT', 'NOIDA', 'GURGAON', 'GURUGRAM', 'KOCHI', 'COCHIN', 'THIRUVANANTHAPURAM', 'TRIVANDRUM', 'MANGALORE', 'MANGALURU', 'MYSORE', 'MYSURU', 'SALEM', 'TIRUPUR', 'TIRUPPUR', 'HOSUR', 'ERODE', 'VELLORE', 'TUTICORIN', 'THOOTHUKUDI', 'PONDICHERRY', 'PUDUCHERRY', 'NAVI MUMBAI', 'BARODA', 'CHANDIGARH', 'JAMSHEDPUR', 'RANCHI', 'RAIPUR', 'BHUBANESWAR', 'GUWAHATI', 'DEHRADUN', 'JODHPUR', 'UDAIPUR', 'KOTA', 'SILIGURI', 'DURGAPUR', 'WARANGAL', 'GUNTUR', 'VIJAYAWADA', 'CHENGALPATTU', 'SANGAREDDY', 'MEDCHAL', 'SUNGUVARCHATIRAM', 'SRI CITY'
    ];

    for (var c = 0; c < cities.length; c++) {
        if (text.indexOf(cities[c]) !== -1) {
            return cities[c];
        }
    }

    var states = {
        'KARNATAKA': 'BANGALORE', 'TAMIL NADU': 'CHENNAI', 'TAMILNADU': 'CHENNAI',
        'MAHARASHTRA': 'MUMBAI', 'TELANGANA': 'HYDERABAD', 'ANDHRA PRADESH': 'SRI CITY'
    };
    for (var state in states) {
        if (text.indexOf(state) !== -1) {
            return states[state];
        }
    }

    return '';
}

function backfillLineNumbers(entries, allLines) {
    var currentLineNo = '';
    var sublineIndex = 0;

    for (var i = 0; i < allLines.length; i++) {
        var line = allLines[i].trim();
        var m = line.match(/Line\s*No\.?\s*:\s*(\d+)/i);
        if (m && !line.match(/Sub\s*line/i)) {
            currentLineNo = m[1];
        }
        var s = line.match(/Sub\s*line\s*No\.?\s*:\s*(\d+)/i);
        if (s && sublineIndex < entries.length) {
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

        var sealImgHtml = '<img src="' + cleanSealBase64 + '" style="height: 75px; width: auto; display: block; margin-left: auto; margin-bottom: 2px;" />';

        var footerHtml = isLastPage ? (
            '<table style="width: 100%; border: none; margin-top: 20px; page-break-inside: avoid; border-collapse: collapse;">' +
                '<tr style="border: none;">' +
                    '<td style="width: 65%; text-align: left; vertical-align: bottom; border: none; padding: 0;">' +
                        '<div class="report-footer" style="font-size: 8pt; line-height: 1.4; padding-right: 10px;">' +
                            '<p style="margin: 2px 0; font-weight: bold; font-size: 8.5pt;">CONTAINER FLOOR BOARD ON GOUGED AT PLACES.</p>' +
                            '<p style="margin: 2px 0;">Issued without Prejudice</p>' +
                            '<p style="margin: 4px 0; text-align: justify;">This report is made on the basis of our inspection to the best of our skill and knowledge and as per findings at the time and place of inspection and the report is issued subject to the condition that neither firm nor any of its Surveyors agents is under any circumstances to be held responsible for any inaccuracy in report or for Certificate issued for or any error of Judgment, default or negligence.</p>' +
                        '</div>' +
                    '</td>' +
                    '<td style="width: 35%; text-align: right; vertical-align: bottom; border: none; padding: 0;">' +
                        '<div style="display: inline-block; text-align: right;">' +
                            sealImgHtml +
                            '<span style="font-size: 9pt; font-weight: bold; display: block; padding-right: 5px; letter-spacing: 0.5px;">SURVEYORS</span>' +
                        '</div>' +
                    '</td>' +
                '</tr>' +
            '</table>'
        ) : '';
        
        var pageStyle = 'page-break-after: always;' + (isFirstPage ? '' : ' padding-top: 15mm; padding-right: 5mm; padding-left: 5mm;');
        
        pagesHtml += '<div class="print-page" style="' + pageStyle + '">' + pageTop + tableHtml + footerHtml + '</div>';
    });

    var printTemplate = document.getElementById('printTemplate');
    printTemplate.innerHTML = pagesHtml;
}

// --- Signature Pad removed - using fixed seal+signature image instead ---

// ===== OCR Manifest Parser =====
function parseOCRManifestText(fullText) {
    // Company Detection - same logic as text parser
    // CARGO CONSOLIDATORS manifests have "CARGO CONSOLIDATORS" in header, "ECCT" in CFS code, or "cargoconsol" email
    // ALLTRANS manifests have generic "SEA CONSOL IGM PRINT" header with NO company name
    var isCARGO = fullText.match(/CARGO\s*CONSOLIDATORS/i) || fullText.match(/ECCT/i) || fullText.match(/cargoconsol/i);
    var companyPrefix = isCARGO ? 'CCIPL' : 'ATSLL';
    
    console.log('--- OCR COMPANY DETECTION ---');
    console.log('Found CARGO CONSOLIDATORS:', !!fullText.match(/CARGO\s*CONSOLIDATORS/i));
    console.log('Found ECCT:', !!fullText.match(/ECCT/i));
    console.log('Found cargoconsol:', !!fullText.match(/cargoconsol/i));
    console.log('Detected company:', isCARGO ? 'CARGO CONSOLIDATORS' : 'ALLTRANS');
    
    var reportNum = getNextReportNumber() || '001';
    extractedData.reportNo = 'SSMS/' + companyPrefix + '/' + reportNum + '/2026';
    
    if (isCARGO) {
        extractedData.location = 'ECCT CFS';
        extractedData.ac = 'CARGO CONSOLIDATORS INDIA PVT LTD';
    } else {
        extractedData.location = 'SATTVA 2 CFS';
        extractedData.ac = 'ALLTRANS SHIPPING AND LOGISTICS LL';
    }
    
    extractedData.port = 'CHENNAI';
    extractedData.sealNo = '';
    
    var allLines = fullText.split('\n');
    
    // Reset data
    var vessel = '';
    var voyage = '';
    var containerNo = '';
    var sealNo = '';
    extractedData.containerNo = '';
    extractedData.auxCode = '';
    var isoCode = '';
    
    for (var i = 0; i < allLines.length; i++) {
        var line = allLines[i].trim();
        
        var vMatch = line.match(/Voyage\s*No\.?\s*:\s*(\S+)\s*Vessel\s*:\s*(.*)/i);
        if (vMatch && !vessel) {
            voyage = vMatch[1].trim();
            vessel = vMatch[2].trim();
        }
        
        var cMatch = line.match(/^([A-Z]{4}\d{7})\s+(?:LCL|FCL)\s+(\S+)\s+\S+\s+[\d\.]+\s+\d+\s+(\d{4})/i);
        if (cMatch && !containerNo) {
            containerNo = cMatch[1];
            sealNo = cMatch[2];
            isoCode = cMatch[3];
        }
    }
    
    extractedData.vessel = (vessel && voyage) ? (vessel + '/' + voyage) : (vessel || voyage || '');
    extractedData.containerNo = containerNo;
    extractedData.sealNo = sealNo;
    
    if (isoCode === '4500' || isoCode === '4400' || isoCode === '45G0' || isoCode === '45G1') {
        extractedData.auxCode = '45G1 (40 HC)';
    } else if (isoCode === '2200' || isoCode === '22G0' || isoCode === '22G1') {
        extractedData.auxCode = '22G1 (20GP)';
    } else {
        extractedData.auxCode = isoCode || '';
    }
    
    // Report number already set above with correct company prefix - don't overwrite
    
    var entries = [];
    var currentEntry = null;
    
    var collectingDesc = false;
    var descBuf = [];
    var collectingMarks = false;
    var marksBuf = [];
    var collectingImporter = false;
    var importerBuf = [];
    
    for (var i = 0; i < allLines.length; i++) {
        var line = allLines[i].trim();
        if (!line) continue;
        
        var lineNoMatch = line.match(/^\s*Line\s*No\.?\s*:\s*(\d+)/i);
        if (lineNoMatch) continue;
        
        var sublineMatch = line.match(/Subline\s*No\.?\s*:\s*(\d+)\s*HBL\s*Number\s*:\s*(\S+)\s*HBL\s*Date\s*:\s*(\S+)/i);
        if (!sublineMatch) sublineMatch = line.match(/Subline\s*No\.?\s*:\s*(\d+)/i);
        
        if (sublineMatch) {
            if (currentEntry) {
                flushOCREntry(currentEntry, descBuf, marksBuf, importerBuf);
                entries.push(currentEntry);
            }
            
            var hblNum = (sublineMatch[2] || '').trim();
            var hblDate = (sublineMatch[3] || '').trim();
            if (!hblNum) {
                var hm = line.match(/HBL\s*Number\s*:\s*(\S+)/i);
                if (hm) hblNum = hm[1];
            }
            if (!hblDate) {
                var dm = line.match(/HBL\s*Date\s*:\s*(\S+)/i);
                if (dm) hblDate = dm[1];
            }
            
            var sNo = sublineMatch[1].replace(/"/g, '1').replace(/'/g, '1');
            if (line.match(/Subline\s*No\.?\s*:\s*\d+["']/i)) {
                // if it ended with quote, it's a typo for 1
                sNo = sNo + '1';
            }
            
            currentEntry = {
                sublineNo: sNo,
                lineNo: '',
                hblNumber: hblNum,
                hblDate: hblDate,
                totalPackages: '0',
                grossWeight: '0.000',
                commodityDesc: '',
                marks: '',
                importerName: ''
            };
            
            descBuf = [];
            marksBuf = [];
            importerBuf = [];
            collectingDesc = false;
            collectingMarks = false;
            collectingImporter = false;
            continue;
        }
        
        if (!currentEntry) continue;
        
        var pkgMatch = line.match(/Total\s*Package[s]?\s*:\s*(\d+)/i);
        if (pkgMatch) currentEntry.totalPackages = pkgMatch[1];
        
        var wtMatch = line.match(/Gross\s*Weight\s*:\s*([\d\.]+)/i);
        if (wtMatch) currentEntry.grossWeight = wtMatch[1];
        
        if (line.match(/Goods\s*Desc\s*:/i)) {
            collectingDesc = true;
            collectingMarks = false;
            collectingImporter = false;
            var descPart = line.replace(/Goods\s*Desc\s*:/i, '').trim();
            if (descPart) descBuf.push(descPart);
            continue;
        }
        
        if (line.match(/Marks\s*:/i)) {
            collectingDesc = false;
            collectingMarks = true;
            collectingImporter = false;
            var markPart = line.replace(/Marks\s*:/i, '').trim();
            if (markPart) marksBuf.push(markPart);
            continue;
        }
        
        if (line.match(/Importer's\s*Name/i) || line.match(/Consignee's\s*Name/i)) {
            collectingDesc = false;
            collectingMarks = false;
            collectingImporter = true;
            continue;
        }
        
        if (line.match(/Container\s*No\.?\s*Cont\s*Status/i) || line.match(/^FFAU\d+/)) {
            collectingImporter = false;
            continue;
        }
        
        if (collectingDesc) {
            if (line.match(/Marks\s*:/i) || line.match(/Importer/i)) { collectingDesc = false; }
            else { descBuf.push(line); continue; }
        }
        if (collectingMarks) {
            if (line.match(/Importer/i) || line.match(/Container/i)) { collectingMarks = false; }
            else { marksBuf.push(line); continue; }
        }
        if (collectingImporter) {
            if (line.match(/Container/i) || line.match(/Line\s*No/i)) { collectingImporter = false; }
            else { importerBuf.push(line); continue; }
        }
    }
    
    if (currentEntry) {
        flushOCREntry(currentEntry, descBuf, marksBuf, importerBuf);
        entries.push(currentEntry);
    }
    
    var currentLineNo = '';
    var sublineIndex = 0;
    for (var i = 0; i < allLines.length; i++) {
        var line = allLines[i].trim();
        var m = line.match(/^\s*Line\s*No\.?\s*:\s*(\d+)/i);
        if (m) currentLineNo = m[1];
        
        var s = line.match(/Subline\s*No\.?\s*:\s*(\d+)/i);
        if (s && sublineIndex < entries.length) {
            entries[sublineIndex].lineNo = currentLineNo;
            sublineIndex++;
        }
    }
    
    extractedData.rows = entries.map(function (entry, index) {
        var lno = (entry.lineNo && entry.sublineNo) ? (entry.lineNo + '-' + entry.sublineNo) : (entry.lineNo || entry.sublineNo || '');
        var hbl = '';
        if (entry.hblNumber && entry.hblDate) hbl = entry.hblNumber + ' ' + entry.hblDate;
        else if (entry.hblNumber) hbl = entry.hblNumber;
        
        var weightVal = parseFloat(entry.grossWeight) || 0;
        
        var marks = entry.marks || '';
        marks = marks.replace(/\bAS\s+PER\s+BL\b/gi, '').trim();
        marks = marks.replace(/\bC\/(?:NO|O)\.?\s*\d+\b/gi, '').trim();

        var desc = entry.commodityDesc || '';
        desc = desc.replace(/\bAS\s+PER\s+BL\b/gi, '').trim();
        desc = desc.replace(/\bHS\s*CODE\b.*$/gi, '').trim();
        
        return {
            sno: index + 1,
            lno: lno,
            marks: marks,
            hbl: hbl,
            importerName: entry.importerName || '',
            description: desc,
            pkgs: entry.totalPackages || '',
            weight: weightVal.toFixed(3),
            remarks: 'APPARENT SOUND CONDITIONS'
        };
    });
    
    document.getElementById('editVessel').value = extractedData.vessel;
    document.getElementById('editReportNo').value = extractedData.reportNo;
    document.getElementById('editContainer').value = extractedData.containerNo;
    document.getElementById('editAuxCode').value = extractedData.auxCode;
    document.getElementById('editLocation').value = extractedData.location;
    document.getElementById('editPort').value = extractedData.port;
    document.getElementById('editSealNo').value = extractedData.sealNo;
    document.getElementById('editAC').value = extractedData.ac;
}

function flushOCREntry(entry, descBuf, marksBuf, importerBuf) {
    if (descBuf.length > 0) {
        var desc = descBuf.join(' ').replace(/\s+/g, ' ').trim().toUpperCase();
        desc = desc.replace(/\bAS\s+PER\s+BL\b/gi, '').trim();
        entry.commodityDesc = desc;
    }
    
    if (marksBuf.length > 0) {
        var marks = marksBuf.join(' ').replace(/\s+/g, ' ').trim().toUpperCase();
        marks = marks.replace(/\bAS\s+PER\s+BL\b/gi, '').trim();
        entry.marks = marks;
    }
    
    if (importerBuf.length > 0) {
        var addressParts = [];
        var companyName = extractLeftHalf(importerBuf[0].trim().toUpperCase());
        for (var k = 1; k < importerBuf.length; k++) {
            var leftHalf = extractLeftHalf(importerBuf[k].trim().toUpperCase());
            leftHalf = leftHalf.replace(/\|\s*P\s*LTD/g, 'PVT LTD').replace(/\|\s*PVT\s*LTD/g, 'PVT LTD').replace(/\|\s*/g, '');
            if (leftHalf) addressParts.push(leftHalf);
        }
        
        companyName = companyName.replace(/\|\s*P\s*LTD/g, 'PVT LTD').replace(/\|\s*PVT\s*LTD/g, 'PVT LTD').replace(/\|\s*/g, '');
        
        var fullAddress = addressParts.join(' ');
        var city = extractCity(fullAddress);
        
        if (city) {
            entry.importerName = companyName + ', ' + city;
        } else {
            entry.importerName = companyName;
        }
    }
}
