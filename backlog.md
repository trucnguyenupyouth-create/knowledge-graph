# Backlog & Future Ideas

### Epic: Continuous Learning (Human-in-the-Loop Mismatched Bug Feedback)
**Mục tiêu:** Xây dựng cơ chế học hỏi liên tục để làm phong phú Knowledge Graph và Bug Library dựa trên các bài giải thực tế của học sinh.

**User Story:** Là một Knowledge Expert, tôi muốn hệ thống giữ lại những lỗ hổng chưa từng xuất hiện để tôi duyệt và phân bổ vào node, giúp hệ thống không ngừng thông minh hơn thay vì chỉ báo "Unknown".

**Luồng đề xuất:**
1. **Discovery (AI):** Ở Stage 2, nếu học sinh có lỗi *Critical* nhưng AI không map được vào bất kỳ BugEntry nào (Unknown Bug), AI sẽ tự động sinh ra một "Draft Bug candidate" (Khái quát hoá nguyên lý lỗi ngắn gọn).
2. **Logging:** Lưu "Draft Bug" này vào bảng `BugCandidate` với status là `PENDING_REVIEW`.
3. **Approval (Expert):** Tại CMS Dashboard, chuyên gia giáo dục xem danh sách mầm bệnh. Nếu đồng ý với đánh giá của AI, họ sẽ chọn 1 Node để map mầm bệnh đó vào.
4. **Enrichment:** Draft Bug chính thức biến thành `BugEntry` thực thụ. Các học sinh sau mắc lỗi y hệt sẽ lập tức được hệ thống nhận diện tự động với độ nhạy 100%. Mạng lưới tri thức (Knowledge Graph) tự động dày lên theo năm tháng.
