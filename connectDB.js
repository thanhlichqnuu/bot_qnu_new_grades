const mongoose = require("mongoose");

const connectDB = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log("Đã kết nối thành công đến MongoDB!");
  } catch (error) {
    console.error("Lỗi kết nối MongoDB:", error);
    process.exit(1); 
  }
};

module.exports = connectDB;