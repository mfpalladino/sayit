// Based on http://pythonhackers.com/p/fluent-ffmpeg/node-fluent-ffmpeg
// and https://trac.ffmpeg.org/wiki/Create%20a%20mosaic%20out%20of%20several%20input%20videos

// Usage:
//   node ffmpeg-mosaic.js file1.mp2 file2.mp4 file3.mp4 file4.mp4
//   Generates out.mp4

const ffmpegPath = require('@ffmpeg-installer/ffmpeg').path;
var ffmpeg = require('fluent-ffmpeg');
ffmpeg.setFfmpegPath(ffmpegPath);
var command = ffmpeg()

// Change this to the desired output resolution  
var x=640, y=480;

var videoInfo = [];

// Parse arguments
var args = process.argv.slice(2);
args.forEach(function (val, index, array) {
    var filename = val;
    console.log(index + ': Input File ... ' + filename);
    
    videoInfo.push({			
	    filename: filename
    });
    command = command.addInput(filename);
});	

videoInfo[0].coord = { x: 0, y: 0 };
videoInfo[1].coord = { x: x/2, y: 0 };
videoInfo[2].coord = { x: 0, y: y/2 };
videoInfo[3].coord = { x: x/2, y: y/2 };

var complexFilter = [];
complexFilter.push('nullsrc=size=' + x + 'x' + y + ' [base0]');
// Scale each video
videoInfo.forEach(function (val, index, array) {
    complexFilter.push({
        filter: 'setpts=PTS-STARTPTS, scale', options: [x/2, y/2],
        inputs: index+':v', outputs: 'block'+index
    });
});
// Build Mosaic, block by block
videoInfo.forEach(function (val, index, array) {
    complexFilter.push({
        filter: 'overlay', options: { shortest:1, x: val.coord.x, y: val.coord.y },
        inputs: ['base'+index, 'block'+index], outputs: 'base'+(index+1)
    });
});

//add sound
complexFilter.push({
    filter: 'amix', options: { inputs: videoInfo.length, duration: 'shortest' }
})

var outFile = 'out.mp4';

command
    .complexFilter(complexFilter, 'base4')
    .save(outFile)
    .on('error', function(err) {
        console.log('An error occurred: ' + err.message);
    })	
    .on('progress', function(progress) { 
        console.log('... frames: ' + progress.frames);
    })
    .on('end', function() { 
        console.log('Finished processing'); 
    });