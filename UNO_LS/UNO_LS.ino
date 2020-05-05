/*  Arduino UNO single channel logic sniffer using the
 *  input capture unit embedded into the microcontroller.
 */


// Bit set and bit reset macros
#define BS(x) (1 << x)
#define BR(x) ~(1 << x)


#define FALLING_EDGE 0
#define RISING_EDGE 1
#define BOTH_EDGE 2

#define PSC_1 0
#define PSC_8 1
#define PSC_64 2
#define PSC_256 3
#define PSC_1024 4

// The incoming data frames must follow the following format:
// 0x11 | edge_param | noise_canceler_param | clock_PSC_param | command
// The data frames must start with the 0x11 character,
// and the parameters have to be sent each time a command is issued.
#define FRAME_SIZE 4
struct settingsStruct {
  uint8_t edge:2;
  uint8_t noise_canceler:1;
  uint8_t clock_PSC:3;
};
volatile settingsStruct settings;


#define INDEX_LIM 800
volatile uint16_t samples[810] = {0};
volatile uint16_t index = 0;
volatile uint8_t initial_state = 0;


bool capture = false;

void (*captureFunction)();
void (*pinFirstCaptFunction)();


ISR(TIMER1_CAPT_vect){
  (*captureFunction)();
}

ISR(TIMER1_OVF_vect){
  cli();
  disableCaptureInterrupt();
  sendData();
  sei();
}

ISR(PCINT0_vect){
  (*pinFirstCaptFunction)();
}


void setup(){
  cli();
  disableCaptureInterrupt();
  disablePCI();
  
  captureFunction = &singleEdgeCapture;
  pinFirstCaptFunction = &firstEdgeSingleTrigger;
  
  // Set TIM1 in normal operations mode
  TCCR1A = 0;
  TCCR1B = 0;
  TIMSK1 = 0;
  
  TCCR1A &= BR(COM1A1) & BR(COM1B1) & BR(COM1A0) & BR(COM1B0);
  
  TCCR1A &= BR(WGM10) & BR(WGM11);
  TCCR1B &= BR(WGM12) & BR(WGM13);


  settings.clock_PSC = PSC_256;
  settings.edge = FALLING_EDGE;
  settings.noise_canceler = 0;

  sei();
  
  pinMode(8, INPUT);
  pinMode(13, OUTPUT);
  pinMode(2, INPUT);
  digitalWrite(13, LOW);
  Serial.begin(9600);
}


void loop(){
  // Prevent out of range access
  if(index >= INDEX_LIM){
    cli();
    disableCaptureInterrupt();
    sendData();
    sei();
  }
  
  serialCompute();
}


// Read incoming data if available and not capturing
void serialCompute(){
  if(!capture){
    char c;
    if(Serial.available() >= FRAME_SIZE + 1){
      c = Serial.read();
      //Serial.write(c);
      if(c == 0x11){ // 0x11 is the device identifier
        settings.edge = Serial.read();
        settings.noise_canceler = Serial.read();
        settings.clock_PSC = Serial.read();
        c = Serial.read();
        
        if(c == 0x01) startAcquire();
      }else{
        for(int x=0; x < FRAME_SIZE; x++){
          Serial.read();
        }
      }
    }
  }
}

// Send captured data to the host
void sendData(){
  uint16_t last_val = 0;
  // Remove undetected Timer1 overflow
  for(int x=0; x < index; x++){
    if(samples[x] < last_val){
      index = x-1;
      break;
    }
    last_val = samples[x];
  }

  // Send the data
  Serial.write(0x12);
  Serial.write((uint8_t)initial_state);
  Serial.write((uint8_t)(index & 0x00FF)); // LSB
  Serial.write((uint8_t)(index >> 8)); // MSB
  for(int i=0; i < index; i++){
    Serial.write((uint8_t)(samples[i] & 0x00FF)); // LSB
    Serial.write((uint8_t)(samples[i] >> 8)); // MSB
  }
  index = 0;
  capture = false;
}


// Must be called after setting intial_state value
void processSettings(){
  setEdge(settings.edge);
  setTim1PSC(settings.clock_PSC);
  setNoiseCanceler(settings.noise_canceler);
}


void startAcquire(){
  cli();
  capture = true;
  index = 0;
  initial_state = digitalRead(8);
  processSettings();
  enablePCI();
  sei();
}


// Triggers on first good edge to reset TIM1
void firstEdgeSingleTrigger(){
  // If the edge detected is the good one
  // we disable pin change interrupt, enable
  // the timer ones, and reset its value.
  // We do not need to save the first sample, as it is always at time 0.
  if((PINB & 0x01) == settings.edge){
    cli();
    resetTIM1();
    disablePCI();
    enableCaptureInterrupt();
    sei();
  }
}

// Same as firstEdgeSingleTrigger(), but we don't
// need to check for the edge, as we trigger on both
void firstEdgeBothTrigger(){
  cli();
  resetTIM1();
  disablePCI();
  enableCaptureInterrupt();
  sei();
}


void singleEdgeCapture(){
  samples[index] = ICR1;
  index++;
}

void bothEdgeCapture(){
  samples[index] = ICR1;
  index++;
  TCCR1B ^= 0x40; // Toggle ICES1 bit as fast as possible
}

// Same as bothEdgeCapture() but with pinchange interrupts instead of Timer1 interrupts
void bothEdgeCapturePCI(){
  samples[index] = TCNT1;
  index++;
}

void setEdge(uint8_t edge){
  switch(edge){
    case FALLING_EDGE: // Trigger on falling edge
      TCCR1B &= BR(ICES1); // Timer edge select
      captureFunction = &singleEdgeCapture;
      pinFirstCaptFunction = &firstEdgeSingleTrigger;
      initial_state = 1;
      break;
      
    case RISING_EDGE: // Trigger on rising edge
      TCCR1B |= BS(ICES1); // Timer edge select
      captureFunction = &singleEdgeCapture;
      pinFirstCaptFunction = &firstEdgeSingleTrigger;
      initial_state = 0;
      break;

    case BOTH_EDGE: // Trigger according to the current state
      // Note that the if statement is inverted, as the real first
      // edge is detected by the pin change interrupt and thus skipped
      if(initial_state == 0) TCCR1B &= BR(ICES1);
      else TCCR1B |= BS(ICES1);
      captureFunction = &bothEdgeCapture;
      pinFirstCaptFunction = &firstEdgeBothTrigger;
      break;
  }
}

// Set the individual Timer 1 prescaler.
// It should never be set to 1, as interruptions
// may not have time to return, and unexpected
// behaviours are to be expected.
void setTim1PSC(int val){
  switch(val){
    case PSC_1:
      TCCR1B |= BS(CS10);
      TCCR1B &= BR(CS11) & BR(CS12);
      break;
      
    case PSC_8:
      TCCR1B |= BS(CS11);
      TCCR1B &= BR(CS10) & BR(CS12);
      break;
      
    case PSC_64:
      TCCR1B |= BS(CS10) | BS(CS11);
      TCCR1B &= BR(CS12);
      break;

    case PSC_256:
      TCCR1B |= BS(CS12);
      TCCR1B &= BR(CS10) & BR(CS11);
      break;

    case PSC_1024:
      TCCR1B |= BS(CS10) | BS(CS12);
      TCCR1B &= BR(CS11);
      break;

    default: //PSC_256
      TCCR1B |= BS(CS12);
      TCCR1B &= BR(CS10) & BR(CS11);
      break;
  }
}

// Noise canceler triggers an interruption if the state is unchanged for 4 clock cycles.
// Activating it will increase the minimum delay required between two edges.
void setNoiseCanceler(uint8_t state){
  if(state) TCCR1B |= BS(ICNC1);
  else TCCR1B &= BR(ICNC1);
}


void resetTIM1(){
  TCNT1 = 0x0000;
  TIFR1 = (1 << TOV1);
}

void enableCaptureInterrupt(){
  TIMSK1 |= BS(ICIE1);
  TIMSK1 |= BS(TOIE1);
  TIFR1 = (1 << ICF1);
}

void disableCaptureInterrupt(){
  TIMSK1 &= BR(ICIE1);
  TIMSK1 &= BR(TOIE1);
}

// Enable Pin Change Interrupt on pin PCINT0
void enablePCI(){
  // Fastest operations possible as it is called in ISR
  PCICR |= 0x01;
  PCMSK0 |= 0X01;
}

// Disable Pin Change Interrupt on pin PCINT0
void disablePCI(){
  // Fastest operations possible as it is called in ISR
  PCICR &= 0xFE;
  PCMSK0 &= 0xFE;
}
