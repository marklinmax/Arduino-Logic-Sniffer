
const MENU_OFFSET_X = 300;
const MENU_OFFSET_Y = 50;
const SPACER = 50;


var comList = [];
var selectedPort;
var serialStateString = "Closed";
var openedPort = null;


var settings = {
    clock_division: "8",
    edge: "Rising",
    noise_canceler: false,
}
var clockOptions = ["8", "64", "256", "1024"];
var triggerOptions = ["Rising", "Falling", "Both"];

var aquiring = false;


var gui;
var ctrlMenu;
var plot;

var zSlider;
var xSlider;


var plotdata = [];

var initial_state = 0;
var sample_size = 0;
var samples = [];


var timeout;

var rcv_timeout = false;
var last_rcv = 0; 
var rcv_max_timeout = 1000;

var dataAcquiring = false;
var rawData = [];

function setup() {
    createCanvas(windowWidth-SPACER, windowHeight-SPACER);
    background(20);
    frameRate(60);

    serial = new p5.SerialPort();

    serial.on("list", serialList);
    serial.on('open', serialOpened);
    serial.on('close', serialClosed);
    serial.on('error', serialError);
    serial.on('data', serialReceive);


    /*for (var i = 0; i < 100; i++) {
        plotdata[i] = new GPoint(i, 10 * noise(0.1 * i));
    }*/

    refreshSettings();
    refreshCOM();
    setPlot();

    refreshXSlider(-1, 50);
    refreshZoomSlider(5, 50);

    noLoop();
}

function draw() {

}

function mouseDragged(){
    //background(20);
    plot.setXLim(getXSliderValue(), getXSliderValue() + getZSliderValue());
    drawPlot(plot);
}


function refreshZoomSlider(min, max){
    if(zSlider) zSlider.remove();
    zSlider = createSlider(min, max, min, 1);
    zSlider.position(windowWidth - SPACER*5 - 320 , windowHeight-SPACER*5);
    zSlider.size(320);
}

function refreshXSlider(min, max){
    if(xSlider) xSlider.remove();
    xSlider = createSlider(min, max, min, 1);
    xSlider.position(SPACER + 3, windowHeight-SPACER*1.7);
    xSlider.size(windowWidth-SPACER*3-MENU_OFFSET_X*2);
}

function getXSliderValue(){
    if(xSlider){
        return xSlider.value();
    }
    else return 0;
}

function getZSliderValue(){
    if(zSlider){
        return zSlider.value();
    }
    else return 0;
}


// GUI related functions

function refreshGui(){
    if(gui) gui.destroy();
    gui = QuickSettings.create(windowWidth - MENU_OFFSET_X*2, MENU_OFFSET_Y, "Menu")
    gui.setDraggable(false);
    gui.setCollapsible(false);
    gui.addHTML("Serial State", serialStateString);
    gui.addDropDown("Select port:", comList, selectCOM);
    gui.addButton("Open", serialOpen);
    gui.addButton("Close", serialClose);
    gui.addButton("Refresh List", refreshCOM);
    gui.addButton("Redraw Plot", setPlot);
    //console.log(gui._content.clientHeight);

    //console.log(settings);
}

function refreshSettings(){
    if(ctrlMenu) ctrlMenu.destroy();
    ctrlMenu = QuickSettings.create(windowWidth - MENU_OFFSET_X - SPACER, MENU_OFFSET_Y, "Controls");
    ctrlMenu.setDraggable(false);
    ctrlMenu.setCollapsible(false);
    ctrlMenu.bindDropDown("edge", triggerOptions, settings);
    ctrlMenu.bindDropDown("clock_division", clockOptions, settings);
    ctrlMenu.bindBoolean("noise_canceler", false, settings);
    ctrlMenu.addHTML("state", "Stopped");
    ctrlMenu.addButton("Acquire", startAcquire);
    ctrlMenu.addButton("Export", outputCSV);
    //ctrlMenu.addButton("Reset", resetAnalyzer);
}

function selectCOM(port){
    selectedPort = port.value;
}

function hideCtrl(){
    if(ctrlMenu){
        ctrlMenu.hideControl("edge");
        ctrlMenu.hideControl("clock_division");
        ctrlMenu.hideControl("noise_canceler");
    }
}

function showCtrl(){
    if(ctrlMenu){
        ctrlMenu.showControl("edge");
        ctrlMenu.showControl("clock_division");
        ctrlMenu.showControl("noise_canceler");
    }
}


// Serial communication related functions

function refreshCOM(){
    let portlist = serial.list();
}

function serialList(list){
    comList = list;
    if(!openedPort) selectedPort = comList[0];
    refreshGui();
}

function serialOpen(){
    if(!openedPort){
        console.log("Opening ".concat(selectedPort).concat("..."));
        serial.open(selectedPort);
    }
}

function serialOpened(){
    openedPort = selectedPort;
    serialStateString = openedPort.concat(" opened");
    refreshGui();
    gui.hideControl("Select port:");
    console.log("Port ".concat(openedPort).concat(" opened!"));
}

function serialClose(){
    if(openedPort){
        console.log("Closing ".concat(openedPort).concat("..."));
        serial.close();
    }
}

function serialClosed(){
    if(openedPort){
        serialStateString = "Closed";
        console.log("Port ".concat(openedPort).concat(" closed!"));
        openedPort = null;
        refreshGui();
    }
}

function serialError(err){
    console.log(err);
}
var ind;
function serialReceive(){

    console.log(serial.available());
    while(dataAcquiring && serial.available()){
        clearTimeout(timeout);
        rawData.push(serial.read());
        timeout = setTimeout(serialTimeout, 2000);
    }
    if(serial.available() >= 4){
        if(serial.read() == 0x12){
            rawData = []
            ind = 0;
            dataAcquiring = true;
            console.log("Start");
            clearTimeout(timeout);
            initial_state = serial.read();

            let LSB = serial.read();
            let MSB = serial.read();
            sample_size = MSB<<8 + LSB;
            console.log("Samples:");
            console.log(sample_size);
        }
    }
}

function serialTimeout(){
    dataAcquiring = false;
    if(rawData.length != 0) processData();
    console.log("Timed out")
}

function isSerialTimeout(){
    if(millis() - last_rcv > rcv_max_timeout){
        rcv_timeout = true;
        return true;
    }
    return false;
}

function resetSerialTimeout(){
    last_rcv = millis();
}

function sendSerialAcquire(){
    serial.write(0x11);

    if(settings.edge == "Falling") serial.write(0x00);
    else if(settings.edge == "Rising") serial.write(0x01);
    else serial.write(0x02);

    if(settings.noise_canceler) serial.write(0x01);
    else serial.write(0x00);

    if(settings.clock_division == "8") serial.write(0x01);
    else if(settings.clock_division == "64") serial.write(0x02);
    else if(settings.clock_division == "256") serial.write(0x03);
    else if(settings.clock_division == "1024") serial.write(0x04);

    serial.write(0x01);
}


// Analyzer related functions

function startAcquire(){
    if(openedPort && !aquiring){
        aquiring = true;
        hideCtrl();
        ctrlMenu.setValue("state", "Waiting for analyzer response...");
        sendSerialAcquire();
        timeout = setTimeout(hasResponse, 20000);
    }
}

function hasResponse(){
    aquiring = false;
    ctrlMenu.setValue("state", "Communication timed out.");
    showCtrl();
}

/*function waitingForData(){
    ctrlMenu.setValue("state", "Waiting for data to be received...");
}*/

function resetAnalyzer(){
    if(openedPort){
        aquiring = false;
        ctrlMenu.setValue("state", "Resetting analyzer...");
        timeout = setTimeout(hasResponse, 5000);
    }
}



// Plot related functions

function setPlot(){
    plot = new GPlot(this);
    plot.setPos(SPACER, SPACER);
    plot.setOuterDim(windowWidth-SPACER*3-MENU_OFFSET_X*2, windowHeight-SPACER*3);
    plot.setPoints(plotdata);
    plot.setPointSize(0);
    plot.setLineWidth(3);
    plot.getXAxis().setAxisLabelText("X");
    plot.getYAxis().setAxisLabelText("Y");
    plot.setTitleText("Plot");
    plot.activatePanning();
    drawPlot(plot);
}

function drawPlot(plt){
    plt.beginDraw();
    plt.drawBackground();
    plt.drawBox();
    plt.drawXAxis();
    plt.drawYAxis();
    plt.drawTitle();
    plt.drawPoints();
    plt.drawLines();
    plt.endDraw();
}

function maxArray(array){
    return Math.max.apply(Math, array)
}

function processData(){
    console.log(rawData);
    for(var x=0; x < rawData.length/2; x++){
        samples.push((rawData[x*2+1]<<8) + rawData[x*2]);
    }
    console.log(samples);


    let current_state;

    xSlider.attribute('max', maxArray(samples))
    zSlider.attribute('max', maxArray(samples))
    
    plotdata = [];

    current_state = initial_state;

    plotdata.push(new GPoint(-1, current_state));
    plotdata.push(new GPoint(0, current_state));
    
    current_state = (current_state+1)%2;
    
    plotdata.push(new GPoint(0, current_state));

    for(var i=0; i < samples.length; i++){
        if(settings.edge == "Both"){
            pushDataBothEdge(i, current_state);
            current_state = (current_state+1)%2;
        }else pushDataSingleEdge(i, current_state);
    }
    plotdata.push(new GPoint(maxArray(samples)+20, current_state));

    setPlot();
    showCtrl();
    ctrlMenu.setValue("state", "Data received successfully");


    rawData = []
}

// Draw a single line for the transition
function pushDataBothEdge(i, state){
    plotdata.push(new GPoint(samples[i], state));
    plotdata.push(new GPoint(samples[i], (state+1)%2));
}

// Draw a square for the transition, and a theoretical previous transition, one tick before
function pushDataSingleEdge(i, state){
    plotdata.push(new GPoint(samples[i]-1, state));
    plotdata.push(new GPoint(samples[i]-1, (state+1)%2));
    plotdata.push(new GPoint(samples[i], (state+1)%2));
    plotdata.push(new GPoint(samples[i], state));
}

function outputCSV(){
    if(samples.length != 0){
        data = new p5.Table();
        data.addColumn("ch1");
        max = maxArray(samples);
        console.log(samples);
        ind = 0;

        let current_state;
        if(settings.edge == "Falling"){
            current_state = 0;
            data.addRow().set("ch1", 1);
            data.addRow().set("ch1", 0);
        }else if(settings.edge == "Rising"){
            current_state = 1;
            data.addRow().set("ch1", 0);
            data.addRow().set("ch1", 1);
        }else{
            current_state = initial_state;
            data.addRow().set("ch1", current_state);
            data.addRow().set("ch1", (current_state+1)%2);
            current_state = (current_state+1)%2;
        }

        for(var x=2; x < max+2; x++){
            data.addRow().set("ch1", current_state);
            if(x == samples[ind]){
                if(settings.edge == "Both"){
                    current_state = (current_state+1)%2;
                }else{
                    if(x > 0) data.set(x-1, "ch1", (current_state+1)%2);
                }
                ind++;
            }
        }

        saveTable(data, "samples.csv", "csv");
    }
}
