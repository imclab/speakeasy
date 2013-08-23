var fs = require('fs');
var path = require('path');
var unzip = require('unzip');
var exec = require('child_process').exec;

var APKS_DIR = './captures/apks';
var ZIPS_DIR = './captures/zips';

var apks = fs.readdirSync(APKS_DIR).filter(function(entry) {
    return entry.match('\\.apk$');
});

if(!fs.existsSync(ZIPS_DIR)) {
    fs.mkdirSync(ZIPS_DIR);
}

var detectedTraits = {};
var apkIndex = 0;

scanNextFile();

function scanNextFile() {
    if(apkIndex < apks.length) {
        var apkFile = apks[apkIndex++];
        console.log('Scanning ' + Math.round(apkIndex/apks.length*100.0).toFixed(2) +'%');
        scanAPK(apkFile, function(resultTraits) {

            detectedTraits[ apkFile ] = resultTraits;

            process.nextTick(scanNextFile);

        });
    } else {
        findTotals();
    }
}

function findTotals() {
    console.log('TIME TO TOTAL!');

    var totals = [];

    for(var packageName in detectedTraits) {
        var traits = detectedTraits[packageName];

        var appEntry = {
            name: packageName,
            traits: Array.prototype.slice.call(traits, 0)
        };

        var total = 0;
        console.log('###### ' + packageName + ' #######');
        traits.forEach(function(tr) {
            console.log('+ ', tr.amount.toFixed(2), '\t', tr.reason);
            total += tr.amount;
        });

        appEntry.total = total.toFixed(2);
        
        console.log(total.toFixed(2) + ' TOTAL');
        console.log('\n---\n');

        totals.push(appEntry);
    }

    fs.writeFileSync('captures/totals.json', JSON.stringify(totals, null, 4));
}

function scanAPK(apkFile, doneCallback) {
    
    var cwd = process.cwd();   
    var apkFullPath = path.join(APKS_DIR, apkFile);
    var zipPath = path.join(ZIPS_DIR, apkFile + '.zip');
    var extractDir = path.join(ZIPS_DIR, apkFile.replace('.apk', ''));
    var tmpDir = path.join(extractDir, 'TMP!!!');
    var classesDex = path.join(extractDir, 'classes.dex');
    var classesTmpDex = path.join(tmpDir, 'classes.dex');
    var classesJar = path.join(tmpDir, 'classes-dex2jar.jar');
    var ddxDir = path.join(extractDir, 'ddx');
    var ddxBin = path.join(cwd, 'ddx1.26.jar');
    var commands = [];

    if(!fs.existsSync(extractDir)) {
        commands.push('cp ' + apkFullPath + ' ' + zipPath);
        commands.push('unzip ' + zipPath + ' -d ' + extractDir);
    }

    if(!fs.existsSync(tmpDir)) {
        commands.push('mkdir ' + tmpDir);
    }

    commands.push('cp ' + classesDex + ' ' + tmpDir);

    if(!fs.existsSync(classesJar)) {

        commands.push('cd ' + tmpDir);

        // converts .dex into .jar
        commands.push('d2j-dex2jar.sh classes.dex');

        // extracts the files inside the .jar
        commands.push('jar xvf classes-dex2jar.jar');
        commands.push('cd ' + cwd);

    }

    // dex dex
    if(!fs.existsSync(ddxDir)) {
        commands.push('mkdir ' + ddxDir);
        commands.push('cp ' + classesDex + ' ' + ddxDir);
        commands.push('cd ' + ddxDir);
        commands.push('java -jar ' + ddxBin + ' -d ' + 'ddx' + ' classes.dex');
        commands.push('cd ' + cwd);
    }

    var cmd = commands.join('; ');
    console.log('Full command', cmd);

    exec(cmd, function(error, stdout, stderr) {
        // We can now actually analyse the APK contents
        detectHTML5ness(extractDir, doneCallback);
    });

}


function filterHTMLfiles(f) {
    return f.match(/\.html?$/i);
}


function filterJSfiles(f) {
    return f.match(/\.js$/i);
}


function filterClassFiles(f) {
    return f.match(/\.class$/i);
}


function filterPhonegapiness(f) {
    var expressions = [
        /com\/phonegap/,
        /com\/sencha/,
        /org\/apache\/cordova/,
        /org\/appcelerator/
    ];

    return expressions.some(function(expression) {
        return f.match(expression);
    });
}


function detectHTML5ness(apkDir, doneCallback) {
    console.log('Guessing html5-ness in', apkDir);

    var apkFiles = recursiveDirList(apkDir);
    var traits = [];

    // Possible HTML5 tell-tale signs
    
    // presence of html files
    var htmlFiles = apkFiles.filter(filterHTMLfiles);

    if(htmlFiles.length) {
        traits.push({
            amount: 5,
            reason: 'Presence of HTML files',
            files: htmlFiles
        });
    }


    // presence of js files
    var jsFiles = apkFiles.filter(filterJSfiles);

    if(jsFiles.length) {
        traits.push({
            amount: 15,
            reason: 'Presence of JavaScript files',
            files: jsFiles
        });
    }


    // classes.dex -> phonegap / ... / classes?
    var javaClasses = apkFiles.filter(filterClassFiles);
    var phonegapey = javaClasses.filter(filterPhonegapiness);

    if(phonegapey.length) {
        traits.push({
            amount: 50,
            reason: 'Presence of Phonegap or similar',
            files: phonegapey
        });
    }

    // webview calls?
    // the uncompiled ddx sort-of-assembly files have some metadata
    // referring to calls to WebView-classes
    // So we'll increase the chances of this being a 'web' app each time
    // a file is using WebView or derived classes
    var ddxDir = path.join(apkDir, 'ddx');

    console.log(ddxDir);

    exec('grep -lr WebView ' + path.join(ddxDir, '*'), function(error, stdout, stderr) {

        var matches = stdout.split('\n');
        var num = matches.length;
        if(num) {
            traits.push({
                amount: num * 0.1,
                reason: num.toFixed(2) + ' calls to WebView',
                files: matches
            });
        }
        
        doneCallback(traits);

    });

}

function recursiveDirList(dir) {

    var results = [];
    var entries = fs.readdirSync(dir);

    entries.forEach(function(entry) {

        var fullPath = path.join(dir, entry);
        var stat = fs.statSync(fullPath);

        if(stat && stat.isDirectory()) {
            results = results.concat( recursiveDirList(fullPath) );
        } else {
            results.push(fullPath);
        }

    });

    return results;
}

